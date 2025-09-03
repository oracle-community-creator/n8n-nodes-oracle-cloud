import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { ApplicationError, NodeOperationError } from 'n8n-workflow';

import { Region, SimpleAuthenticationDetailsProvider } from 'oci-common';

const AIServiceSpeechClient = require('oci-aispeech').AIServiceSpeechClient;
const ObjectStorageClient = require('oci-objectstorage').ObjectStorageClient;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const _privateKeyParse = (privateKey: string) => {
  return (
    '----BEGIN PRIVATE KEY-----' +
    privateKey
      .substr(27, privateKey.indexOf('-----END PRIVATE KEY-----') - 27)
      .replaceAll(' ', '\r\n') +
    '-----END PRIVATE KEY-----'
  );
};

export class SpeechTranscriptionOci implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'OCI Speech Transcription',
    name: 'speechTranscriptionOci',
    group: ['transform'],
    icon: { light: 'file:oracle.svg', dark: 'file:oracle.svg' },
    version: 1,
    description: 'Create and optionally wait for an OCI Speech transcription job, then fetch results from Object Storage',
    defaults: { name: 'OCI Speech Transcription' },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'ociApi',
        required: true,
      },
    ],
    properties: [
      // Required
      {
        displayName: 'Compartment ID',
        name: 'compartmentId',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'ocid1.compartment.oc1..xxxxxxxxxxxx',
      },
      {
        displayName: 'Bucket Namespace',
        name: 'bucketNamespace',
        type: 'string',
        default: '',
        required: true,
      },
      {
        displayName: 'Bucket Name',
        name: 'bucketName',
        type: 'string',
        default: '',
        required: true,
      },
      {
        displayName: 'Audio Object Name',
        name: 'audioObjectName',
        type: 'string',
        default: '',
        required: true,
        description: 'Exact object name (path) of the audio file in the specified bucket',
        placeholder: 'path/to/audio-file.wav',
      },
      {
        displayName: 'Model Type',
        name: 'modelType',
        type: 'options',
        options: [
          { name: 'WHISPER_MEDIUM', value: 'WHISPER_MEDIUM' },
          { name: 'ORACLE', value: 'ORACLE' },
        ],
        default: 'ORACLE',
        required: true,
      },
      {
        displayName: 'Speaker Diarization',
        name: 'diarization',
        type: 'boolean',
        default: false,
        required: true,
        description: 'Enable speaker diarization'
      },
      {
        displayName: 'Output Type',
        name: 'outputType',
        type: 'options',
        options: [
          { name: 'JSON (Wait and Return Result)', value: 'json' },
          { name: 'Job ID (Return Immediately)', value: 'job_id' },
        ],
        default: 'json',
        required: true,
      },

      // Optional (collapsible collection)
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        default: {},
        options: [
					{
            displayName: 'Language Code',
            name: 'languageCode',
            type: 'string',
            default: '',
            description: 'BCP-47 language code (e.g. en-US) if known',
          },
					{
            displayName: 'Max Wait (Minutes)',
            name: 'maxWaitMinutes',
            type: 'number',
            default: 30,
            description: 'Upper bound to wait for job completion when returning JSON'
          },
					{
            displayName: 'Number of Speakers',
            name: 'numberOfSpeakers',
            type: 'number',
            typeOptions: { minValue: 1 },
            default: 0,
            description: 'Optional max speakers for diarization (0 to let service decide)'
          },
					{
            displayName: 'Output Prefix',
            name: 'outputPrefix',
            type: 'string',
            default: 'transcriptions/',
            description: 'Prefix in the bucket to store results'
          },
					{
            displayName: 'Poll Interval (Seconds)',
            name: 'pollIntervalSeconds',
            type: 'number',
            default: 5,
            description: 'How often to poll job status when waiting for result'
          },
          {
            displayName: 'Strict Options',
            name: 'strictOptions',
            type: 'boolean',
            default: true,
            description: 'If enabled, fail the node when the service does not apply the requested model/language'
          },
          {
            displayName: 'Transcript Format',
            name: 'transcriptFormat',
            type: 'options',
            options: [
              { name: 'JSON', value: 'JSON' },
              { name: 'SRT', value: 'SRT' },
            ],
            default: 'JSON',
            description: 'Primary transcript format to request',
          },
        ],
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnItems: INodeExecutionData[] = [];

    const credentials = await this.getCredentials('ociApi');
    let privateKey = credentials.privateKey as string;
    privateKey = _privateKeyParse(privateKey);
    credentials.privateKey = privateKey;

    const authProvider = new SimpleAuthenticationDetailsProvider(
      credentials.tenancyOcid as string,
      credentials.userOcid as string,
      credentials.keyFingerprint as string,
      credentials.privateKey as string,
      null,
      Region.fromRegionId(credentials.region as string),
    );

    const speechClient = new AIServiceSpeechClient({ authenticationDetailsProvider: authProvider });
    const objectClient = new ObjectStorageClient({ authenticationDetailsProvider: authProvider });

    // Process each incoming item
    for (let i = 0; i < items.length; i++) {
      try {
        const compartmentId = this.getNodeParameter('compartmentId', i) as string;
        const bucketNamespace = this.getNodeParameter('bucketNamespace', i) as string;
        const bucketName = this.getNodeParameter('bucketName', i) as string;
        let modelType = this.getNodeParameter('modelType', i) as string;
        if (modelType) modelType = String(modelType).toUpperCase();
        const diarization = this.getNodeParameter('diarization', i) as boolean;
        const outputType = this.getNodeParameter('outputType', i) as string;

        const options = (this.getNodeParameter('options', i, {}) as Record<string, any>) || {};
        const transcriptFormat = (options.transcriptFormat as string) ?? 'JSON';
        const languageCode = (options.languageCode as string) || undefined;
        const numberOfSpeakers = (options.numberOfSpeakers as number) ?? 0;
        const audioObjectName = this.getNodeParameter('audioObjectName', i) as string;
        const outputPrefix = (options.outputPrefix as string) ?? 'transcriptions/';
        const pollIntervalSeconds = (options.pollIntervalSeconds as number) ?? 2;
        const maxWaitMinutes = (options.maxWaitMinutes as number) ?? 30;
        const strictOptions = (options.strictOptions as boolean) ?? true;

        // Build payload exactly per SDK typings
        const createDetails: any = {
          compartmentId,
          inputLocation: {
            locationType: 'OBJECT_LIST_INLINE_INPUT_LOCATION',
            objectLocations: [
              {
                namespaceName: bucketNamespace,
                bucketName,
                objectNames: [audioObjectName],
              },
            ],
          },
          outputLocation: {
            namespaceName: bucketNamespace,
            bucketName,
            prefix: outputPrefix,
          },
          modelDetails: {
            modelType,
          },
        };

        if (languageCode) {
          createDetails.modelDetails.languageCode = languageCode;
        }
        // Set a safe default domain when using ORACLE models
        if (modelType === 'ORACLE' && !createDetails.modelDetails.domain) {
          createDetails.modelDetails.domain = 'GENERIC';
        }
        if (diarization) {
          createDetails.modelDetails.transcriptionSettings = {
            diarization: {
              isDiarizationEnabled: true,
              ...(numberOfSpeakers && numberOfSpeakers > 0 ? { numberOfSpeakers } : {}),
            },
          };
        }
        if (transcriptFormat && transcriptFormat.toUpperCase() === 'SRT') {
          createDetails.additionalTranscriptionFormats = ['SRT'];
        }

        let createResponse: any;
        try {
          createResponse = await speechClient.createTranscriptionJob({
            createTranscriptionJobDetails: createDetails,
          });
        } catch (err: any) {
          const status = err?.statusCode || err?.status;
          const opcRequestId = err?.opcRequestId || err?.response?.headers?.['opc-request-id'];
          const details = err?.message || err?.body || err;
          this.logger.error('OCI Speech createTranscriptionJob error', { status, opcRequestId, details } as any);
          throw new NodeOperationError(this.getNode(), 'Failed to create transcription job', {
            description: typeof details === 'string' ? details : JSON.stringify(details),
          });
        }

        const job = createResponse?.transcriptionJob || createResponse?.transcriptionJob?.transcriptionJob || createResponse;
        const jobId: string = job?.id || job?.transcriptionJob?.id;

        if (!jobId) {
          throw new ApplicationError('Failed to create transcription job: missing job ID in response');
        }

        if (outputType === 'job_id') {
          returnItems.push({ json: { jobId } });
          continue;
        }

        // Wait for completion and then fetch JSON result from bucket
        const deadline = Date.now() + maxWaitMinutes * 60 * 1000;
        let lifecycleState = job?.lifecycleState || job?.lifecycleState?.toString?.();

        let finalJobDetails: any | undefined;
        while (!['SUCCEEDED', 'FAILED', 'CANCELED'].includes(String(lifecycleState))) {
          if (Date.now() > deadline) {
            throw new ApplicationError('Timed out waiting for transcription job to complete');
          }
          await sleep(pollIntervalSeconds * 1000);
          let getResp: any;
          try {
            getResp = await speechClient.getTranscriptionJob({ transcriptionJobId: jobId });
          } catch (err: any) {
            const status = err?.statusCode || err?.status;
            const opcRequestId = err?.opcRequestId || err?.response?.headers?.['opc-request-id'];
            const details = err?.message || err?.body || err;
            this.logger.error('OCI Speech getTranscriptionJob error', { status, opcRequestId, details } as any);
            throw new NodeOperationError(this.getNode(), 'Failed to get transcription job status', {
              description: typeof details === 'string' ? details : JSON.stringify(details),
            });
          }
          const current = getResp?.transcriptionJob || getResp?.transcriptionJob?.transcriptionJob || getResp;
          finalJobDetails = current;
          lifecycleState = current?.lifecycleState || current?.lifecycleState?.toString?.();
        }

        if (String(lifecycleState) !== 'SUCCEEDED') {
          throw new ApplicationError(`Transcription job did not succeed. State: ${lifecycleState}`);
        }

        // Results are written to Object Storage under a job-specific folder. Prefer files that include the job short ID.
        const shortId = (jobId?.split?.('.')?.pop?.() as string) || '';
        const prefixesToTry = [
          outputPrefix.endsWith('/') ? `${outputPrefix}` : `${outputPrefix}/`,
          outputPrefix.endsWith('/') ? `${outputPrefix}job-${shortId}/` : `${outputPrefix}/job-${shortId}/`,
          outputPrefix.endsWith('/') ? `${outputPrefix}${shortId}/` : `${outputPrefix}/${shortId}/`,
        ];

        let jsonObjectName: string | undefined;
        let allObjects: Array<{ name: string }> = [];
        for (const prefixToTry of prefixesToTry) {
          const listResp = await objectClient.listObjects({
            namespaceName: bucketNamespace,
            bucketName,
            prefix: prefixToTry,
          });
          const objects = (listResp?.listObjects?.objects || listResp?.objects || []).map((o: any) => ({ name: o.name || o.objectName }));
          allObjects = allObjects.concat(objects);
        }
        // De-duplicate
        const seen = new Set<string>();
        allObjects = allObjects.filter((o) => {
          if (!o?.name) return false;
          const key = String(o.name);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        const lower = (s: string) => s.toLowerCase();
        const isJson = (s: string) => lower(s).endsWith('.json');
        const preferJob = allObjects.find((o) => isJson(o.name) && o.name.includes(`job-${shortId}`));
        const preferShort = allObjects.find((o) => isJson(o.name) && o.name.includes(shortId));
        const anyJson = allObjects.find((o) => isJson(o.name));
        jsonObjectName = preferJob?.name || preferShort?.name || anyJson?.name;

        if (!jsonObjectName) {
          throw new ApplicationError('Could not locate JSON result object for this job in the specified bucket/prefix');
        }

        if (!jsonObjectName) {
          throw new ApplicationError('Could not locate JSON result object in the specified bucket/prefix');
        }

        const getObjResp = await objectClient.getObject({
          namespaceName: bucketNamespace,
          bucketName,
          objectName: jsonObjectName,
        });

        const readResponseBodyAsString = async (resp: any): Promise<string> => {
          const candidate = resp?.value ?? resp?.data ?? resp?.body ?? resp;

          if (candidate && typeof candidate.text === 'function') {
            return await candidate.text();
          }
          if (candidate && typeof candidate.arrayBuffer === 'function') {
            const ab = await candidate.arrayBuffer();
            return Buffer.from(ab).toString('utf8');
          }

          // Web ReadableStream
          if (candidate && typeof candidate.getReader === 'function') {
            const reader = candidate.getReader();
            const chunks: Uint8Array[] = [];
            // eslint-disable-next-line no-constant-condition
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) chunks.push(value);
            }
            return Buffer.concat(chunks.map((u) => Buffer.from(u))).toString('utf8');
          }

          // Node.js Readable stream
          if (candidate && typeof candidate.on === 'function') {
            const chunks: Buffer[] = [];
            await new Promise<void>((resolve, reject) => {
              candidate
                .on('data', (chunk: any) => chunks.push(Buffer.from(chunk)))
                .on('end', () => resolve())
                .on('error', (err: any) => reject(err));
            });
            return Buffer.concat(chunks).toString('utf8');
          }

          // Raw types
          if (typeof candidate === 'string') return candidate;
          if (candidate instanceof Uint8Array) return Buffer.from(candidate).toString('utf8');
          if (candidate && candidate.type === 'Buffer' && Array.isArray(candidate.data)) {
            return Buffer.from(candidate.data).toString('utf8');
          }

          // Last resort
          return JSON.stringify(candidate);
        };

        const bodyStr = await readResponseBodyAsString(getObjResp);
        let parsed: unknown;
        try {
          parsed = JSON.parse(bodyStr);
        } catch (e) {
          throw new ApplicationError('Downloaded object is not valid JSON');
        }

        const parsedObj = (parsed as any) ?? {};
        const resultModel = parsedObj?.modelDetails?.modelType;
        const resultLang = parsedObj?.modelDetails?.languageCode;
        const jobModel = finalJobDetails?.modelDetails?.modelType;
        const jobLang = finalJobDetails?.modelDetails?.languageCode;
        const appliedModel = resultModel ?? jobModel;
        const appliedLang = resultLang ?? jobLang;

        if (strictOptions) {
          const modelMismatch = appliedModel && modelType && String(appliedModel).toUpperCase() !== String(modelType).toUpperCase();
          const langMismatch = languageCode && appliedLang && String(appliedLang) !== String(languageCode);
          const jobVsResultMismatch = (jobModel && resultModel && String(jobModel).toUpperCase() !== String(resultModel).toUpperCase()) ||
            (jobLang && resultLang && String(jobLang) !== String(resultLang));
          if (modelMismatch || langMismatch || jobVsResultMismatch) {
            const problems: string[] = [];
            if (modelMismatch) problems.push(`modelType requested ${modelType} but applied ${appliedModel}`);
            if (langMismatch) problems.push(`languageCode requested ${languageCode} but applied ${appliedLang}`);
            if (jobVsResultMismatch) problems.push(`service reported different model/language in job vs result (job: ${jobModel}/${jobLang}, result: ${resultModel}/${resultLang})`);
            throw new NodeOperationError(this.getNode(), 'Transcription job did not apply requested options', {
              description: problems.join('; '),
            });
          }
        }

        returnItems.push({
          json: {
            jobId,
            objectName: jsonObjectName,
            result: parsed as Record<string, unknown>,
            appliedModelType: appliedModel,
            appliedLanguageCode: appliedLang,
            jobReportedModelType: jobModel,
            jobReportedLanguageCode: jobLang,
          },
        });
      } catch (error: any) {
        if (error instanceof NodeOperationError) throw error;
        throw new NodeOperationError(this.getNode(), error, { message: error.message });
      }
    }

    return [returnItems];
  }
}
