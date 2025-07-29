import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class OracleDatabaseApi implements ICredentialType {
	name = 'oracleDatabaseApi';

	displayName = 'Oracle Database API';

	documentationUrl = 'https://docs.oracle.com/en-us/iaas/autonomous-database-serverless/doc/connect-jdbc-thin-tls.html';

	icon = { light: 'file:icons/oracle.svg', dark: 'file:icons/oracle.svg' } as const;

	properties: INodeProperties[] = [
		{
			displayName: 'User',
			name: 'user',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
		{
			displayName: 'Is autonomous database?',
			name: 'isAutonomous',
			type: 'boolean',
			default: false
		},
		// TODO: CALLOUT ABOUT MTLS
		{
			displayName: 'Host',
			name: 'host',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'Port',
			name: 'port',
			type: 'number',
			default: '',
			required: true,
		},
		{
			displayName: 'Service Name',
			name: 'serviceName',
			type: 'string',
			default: '',
			required: true,
		},
	];
}
