import type {
	ICredentialType,
	INodeProperties,
	INodePropertyOptions
 } from 'n8n-workflow';

 import { Region } from 'oci-common';


export class OciApi implements ICredentialType {
	name = 'ociApi';

	displayName = 'Oracle Cloud Infrastructure API';

	documentationUrl = 'https://docs.oracle.com/en-us/iaas/Content/API/Concepts/apisigningkey.htm';

	icon = { light: 'file:icons/oracle.svg', dark: 'file:icons/oracle.svg' } as const;

	properties: INodeProperties[] = [
		{
			displayName: 'User OCID',
			name: 'userOcid',
			type: 'string',
			default: '',
			placeholder: 'ocid1.user.oc1..xxxxxxxxxxxx',
			required: true,
		},
		{
			displayName: 'Tenancy OCID',
			name: 'tenancyOcid',
			type: 'string',
			default: '',
			placeholder: 'ocid1.tenancy.oc1..xxxxxxxxxxxx',
			required: true,
		},
		{
			displayName: 'Key Fingerprint',
			name: 'keyFingerprint',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx',
			required: true,
		},

		{
			displayName: 'Region',
			name: 'region',
			type: 'options',
			default: 'us-chicago-1',
			options: Region.values().map(region => (
				{
						name: region.regionId,
						value: region.regionId
				} as INodePropertyOptions
			)).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
			required: true,
		},
		{
			displayName: 'Private Key',
			name: 'privateKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			placeholder: '-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----',
			required: true,
		},
		{
			displayName: 'Private Key Passphrase',
			name: 'passphrase',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			placeholder: '',
			required: false,
		},
	];
}
