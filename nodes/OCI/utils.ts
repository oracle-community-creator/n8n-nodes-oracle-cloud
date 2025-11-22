// const _privateKeyParse = (privateKey: string) => {
// 	return '----BEGIN PRIVATE KEY-----' +
// 			privateKey
// 				.substr(27, privateKey.indexOf('-----END PRIVATE KEY-----') - 27)
// 				.replaceAll(' ', '\r\n') +
// 			'-----END PRIVATE KEY-----';
// }

// export function _privateKeyParse(privateKey: string) {
//   const beginMarker = '-----BEGIN RSA PRIVATE KEY-----';
//   const endMarker = '-----END RSA PRIVATE KEY-----';
//   // Find the start and end positions of the key content
//   const startIdx = privateKey.indexOf(beginMarker);
//   const endIdx = privateKey.indexOf(endMarker);
//   // If markers not found, return the original input
//   if (startIdx === -1 || endIdx === -1) return privateKey;
//   // Extract sections
//   const before = privateKey.slice(0, startIdx + beginMarker.length);
//   const middle = privateKey.slice(startIdx + beginMarker.length, endIdx);
//   const after = privateKey.slice(endIdx);
//   // Replace only spaces in the key content with \n
//   const formattedMiddle = middle.replace(/ +/g, '\n');
//   // Concatenate and return the result
//   return before + formattedMiddle + after;
// }


export const privateKeyParse = (privateKey: string): string => {
  if (!privateKey) return '';

  const saneKey = privateKey.trim().replace(/\\n/g, '\n');

  const match = saneKey.match(/-----BEGIN ([A-Z\s]+)-----([\s\S]*?)-----END \1-----/);

  if (!match) {
    console.warn("Key format not automatically detected. Attempting to format raw content.");
    const rawBody = saneKey.replace(/[\s\r\n]/g, '');
    return formatBody(rawBody, 'PRIVATE KEY');
  }

  const type = match[1];
  const body = match[2];

  const cleanBody = body.replace(/[\s\r\n]/g, '');

  return formatBody(cleanBody, type);
};

const formatBody = (body: string, type: string): string => {
  const chunked = body.match(/.{1,64}/g)?.join('\n');
  return `-----BEGIN ${type}-----\n${chunked}\n-----END ${type}-----`;
};
