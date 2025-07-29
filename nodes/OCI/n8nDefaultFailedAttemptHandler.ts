const STATUS_NO_RETRY = [
	400, // Bad Request
	401, // Unauthorized
	402, // Payment Required
	403, // Forbidden
	404, // Not Found
	405, // Method Not Allowed
	406, // Not Acceptable
	407, // Proxy Authentication Required
	409, // Conflict
];

/**
 * This function is used as a default handler for failed attempts in all LLMs.
 * It is based on a default handler from the langchain core package.
 * It throws an error when it encounters a known error that should not be retried.
 * @param error
 */
export const n8nDefaultFailedAttemptHandler = (error: any) => {
	if (
		error?.message?.startsWith?.('Cancel') ||
		error?.message?.startsWith?.('AbortError') ||
		error?.name === 'AbortError'
	) {
		throw error;
	}

	if (error?.code === 'ECONNABORTED') {
		throw error;
	}

	const status = error?.response?.status ?? error?.status;
	if (status && STATUS_NO_RETRY.includes(+status)) {
		throw error;
	}
};
