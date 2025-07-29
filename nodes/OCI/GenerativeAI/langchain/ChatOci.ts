import {
	BaseChatModel,
	type BaseChatModelParams,
} from '@langchain/core/language_models/chat_models';
import {
	AIMessage,
	BaseMessage,
	ToolMessage,
	HumanMessage,
	isAIMessage,
	isToolMessage,
	isHumanMessage,
	isSystemMessage,
	SystemMessage,
} from '@langchain/core/messages';
import { ToolCall } from '@langchain/core/messages/tool';
import { ChatResult } from '@langchain/core/outputs';
import { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { GenerativeAiInferenceClient, models } from 'oci-generativeaiinference';
import { AuthenticationDetailsProvider } from 'oci-common';
import { type RunnableToolLike } from '@langchain/core/runnables';
import { StructuredToolInterface } from '@langchain/core/tools';
import { ChatResponse } from 'oci-generativeaiinference/lib/response';
import * as model from 'oci-generativeaiinference/lib/model'
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { JsonSchema7Type } from 'zod-to-json-schema';

// Convert JSON Schema type to Cohere type
function jsonSchemaTypeToCohereType(jsonSchema: JsonSchema7Type): string {
  // Handle enum types
  if (jsonSchema && typeof jsonSchema === 'object' && 'enum' in jsonSchema) {
    return 'str'; // Cohere treats enums as strings
  }

  // Handle array types
  if (jsonSchema && typeof jsonSchema === 'object' && 'type' in jsonSchema && jsonSchema.type === 'array') {
    return 'list';
  }

  // Handle object types
  if (jsonSchema && typeof jsonSchema === 'object' && 'type' in jsonSchema && jsonSchema.type === 'object') {
    return 'dict';
  }

  // Handle primitive types
  if (jsonSchema && typeof jsonSchema === 'object' && 'type' in jsonSchema && jsonSchema.type) {
    switch (jsonSchema.type) {
      case 'string':
        return 'str';
      case 'number':
      case 'integer':
        return 'float';
      case 'boolean':
        return 'bool';
      default:
        return 'str'; // Default fallback
    }
  }

  return 'str'; // Default fallback
}

function jsonSchemaToCoherePrameters(jsonSchema: JsonSchema7Type): Record<string, models.CohereParameterDefinition> {
  const parameters: Record<string, {
    description: string;
    type: string;
    isRequired?: boolean;
  }> = {};

  // Handle object schema with properties
  if (jsonSchema &&
      typeof jsonSchema === 'object' &&
			'type' in jsonSchema &&
      jsonSchema.type === 'object' &&
			'properties' in jsonSchema &&
      jsonSchema.properties
		) {

    Object.entries(jsonSchema.properties).forEach(([key, propertySchema]) => {

      const description =
        (propertySchema && typeof propertySchema === 'object' && 'description' in propertySchema && propertySchema.description) ||
        (propertySchema && typeof propertySchema === 'object' && 'title' in propertySchema && propertySchema.title) ||
        `Parameter ${key}`;

      parameters[key] = {
        description: String(description),
        type: jsonSchemaTypeToCohereType(propertySchema),
        isRequired: true
      };
    });
  }

  return parameters;
}

// TODO: hadle multimodal messages (img)
function _toOciGenericApiMessage(message: BaseMessage) {
	if (isHumanMessage(message)) {
			// TODO: handle humanMessage.content (MessageContentComplex | DataContentBlock)[]
			const humanMessage = message as HumanMessage;
			return {
				role: 'USER',
				content: [
					{
						type: 'TEXT',
						text: humanMessage.content as string,
					} as model.TextContent,
				],
			} as model.UserMessage;
	} else if (isAIMessage(message)) {
			const aiMessage = message as AIMessage;
			return {
				role: 'ASSISTANT',
				content: [
					{
						type: 'TEXT',
						text: aiMessage.content as string
					} as model.TextContent
				],
				toolCalls: aiMessage.tool_calls?.map((toolCall: ToolCall) => {
					return {
						id: toolCall.id,
						type: "FUNCTION",
						name: toolCall.name,
						arguments: JSON.stringify(toolCall.args)
					} as model.FunctionCall
				})
		} as model.AssistantMessage;
	} else if (isSystemMessage(message)) {
			// TODO: handle humanMessage.content (MessageContentComplex | DataContentBlock)[]
			const systemMessage = message as SystemMessage;
			return {
				role: 'SYSTEM',
				content: [
					{
						type: 'TEXT',
						text: systemMessage.content as string,
					} as model.TextContent,
				],
			} as model.SystemMessage;
	} else if (isToolMessage(message)) {
			// TODO: handle humanMessage.content (MessageContentComplex | DataContentBlock)[]
			const toolMessage = message as ToolMessage;
			return {
				role: 'TOOL',
				toolCallId: toolMessage.tool_call_id,
				content: [
					{
						type: 'TEXT',
						text: toolMessage.content as string,
					} as model.TextContent,
				],
			} as model.ToolMessage;
	} else {
			throw new Error(`Got unexpected message type for Generic format`);
	}
}

function _toOciCohereMessage(message: BaseMessage) {
	if (isHumanMessage(message)) {
		// TODO: handle humanMessage.content (MessageContentComplex | DataContentBlock)[]
		const humanMessage = message as HumanMessage;
		return {
			role: 'USER',
			message: humanMessage.content as string
		} as model.CohereUserMessage;
	} else if (isAIMessage(message)) {
			const aiMessage = message as AIMessage;
			if (aiMessage.tool_calls && aiMessage.tool_calls?.length > 0) {
				if (aiMessage.content) {
					// TODO: fix, return chatbot message as last
					console.log("DANGER DANGER DANGER DANGER ", aiMessage.content);
				}
				return aiMessage.tool_calls;
			}
			return  {
				role: 'CHATBOT',
				message: aiMessage.content as string,
				toolCalls: aiMessage.tool_calls?.map((toolCall: ToolCall) => {
					return {
						name: toolCall.name,
						parameters: toolCall.args
					} as model.CohereToolCall
				})
		} as model.CohereChatBotMessage;
	} else if (isSystemMessage(message)) {
			// TODO: handle COhere System Message in preamble override
			// TODO: handle humanMessage.content (MessageContentComplex | DataContentBlock)[]
			const systemMessage = message as SystemMessage;
			return {
				role: 'SYSTEM',
				message: systemMessage.content as string,
			} as model.CohereSystemMessage;
	} else if (isToolMessage(message)) {
			// TODO: handle humanMessage.content (MessageContentComplex | DataContentBlock)[]
			const toolMessage = message as ToolMessage;
			console.log('toolMessage content: ', toolMessage.content)
			return {
				role: 'TOOL',
				toolResults: [
					{
						call: {
							 name: toolMessage.tool_call_id,
							 parameters: {}
						} as models.CohereToolCall,
						outputs: JSON.parse(toolMessage.content as string)
					} as models.CohereToolResult
				]
			} as model.CohereToolMessage;
	} else {
			throw new Error(`Got unexpected message type for Generic format`);
	}
}


export interface OciGenerativeAiInput extends BaseChatModelParams {
	model: string;
	compartmentId: string;
	auth: {
		authProvider: AuthenticationDetailsProvider;
	};

	temperature?: number;
	topP?: number;
	topK?: number;
	maxTokens?: number;
	frequencyPenalty?: number;
	presencePenalty?: number;

	tools?: (model.ToolDefinition | model.CohereTool)[];
}

export class ChatOciGenerativeAi extends BaseChatModel {
	model: string;
	compartmentId: string;
	auth: {
		authProvider: AuthenticationDetailsProvider;
	};

	temperature?: number;
	topP?: number;
	topK?: number;
	maxTokens?: number;
	client: GenerativeAiInferenceClient;
	frequencyPenalty?: number;
	presencePenalty?: number;

	tools?: (model.ToolDefinition | model.CohereTool)[];

	constructor(fields: OciGenerativeAiInput) {
		super(fields);
		this.model = fields.model;
		this.temperature = fields.temperature;
		this.topP = fields.topP;
		this.topK = fields.topK;
		this.maxTokens = fields.maxTokens;
		this.frequencyPenalty = fields.frequencyPenalty;
		this.presencePenalty = fields.presencePenalty;
		this.compartmentId = fields.compartmentId;
		this.auth = fields.auth;
		this.client = new GenerativeAiInferenceClient({
			authenticationDetailsProvider: fields.auth.authProvider,
		});

		this.tools = fields.tools;
	}

	_llmType() {
		return 'oci_generative_ai';
	}

	bindTools(tools: (StructuredToolInterface | Record<string, any> | RunnableToolLike)[]): this {
		let genericTools: model.ToolDefinition[] = []
		let cohereTools: model.CohereTool[] = []

		if (this.model.startsWith('cohere')) {
			cohereTools = tools.map((tool) => {
				const jsonSchema: JsonSchema7Type = toJsonSchema(tool.schema);
				return {
					name: tool.name,
					description: tool.description,
					parameterDefinitions: jsonSchemaToCoherePrameters(jsonSchema) as Record<string, models.CohereParameterDefinition>,
				} as model.CohereTool
			});
		} else {
			genericTools = tools.map((tool) => {
				return {
						name: tool.name,
						description: tool.description,
						parameters: toJsonSchema(tool.schema),
						type: 'FUNCTION'
				} as model.FunctionDefinition
			})
		}

		const ociTools = genericTools.length > 0 ? genericTools : cohereTools;
		const fields: OciGenerativeAiInput = {
			model: this.model,
			temperature: this.temperature,
			frequencyPenalty: this.frequencyPenalty,
			presencePenalty: this.presencePenalty,
			topP: this.topP,
			topK: this.topK,
			maxTokens: this.maxTokens,
			compartmentId: this.compartmentId,
			auth: this.auth,
			tools: ociTools
		};
		return new (this.constructor as new (fields: OciGenerativeAiInput) => this)(fields);
	}

	async _generate(
		messages: BaseMessage[],
		options: this['ParsedCallOptions'],
		runManager?: CallbackManagerForLLMRun,
	): Promise<ChatResult> {
		let chatRequest: models.CohereChatRequest | models.GenericChatRequest;

		if (this.model.startsWith('cohere')) {
			// TODO: adjust temperature and topK
			let ociMessages = messages.map(_toOciCohereMessage);
			const toolMessages: models.CohereToolMessage[] = [];
			let toolCalls: ToolCall[] = [];
			ociMessages.forEach((message) => {
				if (Array.isArray(message)) {
					toolCalls = message;
				} else if (message.role === "TOOL") {
					// TODO: Importante: buscar só os últimos tool messages
					toolMessages.push(message as models.CohereToolMessage)
				}
			})
			console.log('ociMessages0', ociMessages)
			const ociMessagesClean = ociMessages.filter((message) => (!Array.isArray(message) && message.role !== "TOOL"));
			console.log('ociMessages1', ociMessagesClean)
			let message = '';

			let toolResults: (models.CohereToolResult[] | undefined);
			let toolMessageLast: (models.CohereToolMessage | undefined);
			if (toolMessages.length > 0) {
				// Tool Call
				toolResults = toolMessages.map((toolMessage) => {
					const toolResult = toolMessage.toolResults[0];
					const toolCall = toolCalls.find((toolCall) => toolCall.id === toolResult.call.name)
					if (toolCall) {
						toolResult.call.parameters = toolCall.args;
					}
					return toolResult;
				})

				// Consolidate tool messages into a single instance
				toolMessageLast = {
					toolResults,
					role: "TOOL"
				}
			} else {
				const lastMessage = ociMessagesClean.pop();
				if (lastMessage && !Array.isArray(lastMessage) && lastMessage.role === "USER") {
					// User Message
					message = (lastMessage as models.CohereUserMessage)?.message
				} else {
					// Unknown
					if (lastMessage) {
						ociMessagesClean.push(lastMessage);
					}
				}
			}

			if (toolMessageLast) {
				ociMessagesClean.push(toolMessageLast)
			}
			console.log('ociMessages', ociMessagesClean);

			chatRequest = {
				apiFormat: 'COHERE',
				message,
				chatHistory: ociMessagesClean,
				temperature: this.temperature,
				topP: this.topP,
				topK: this.topK,
				maxTokens: this.maxTokens,
				frequencyPenalty: this.frequencyPenalty,
				presencePenalty: this.presencePenalty,
				tools: this.tools,
				toolResults
			} as models.CohereChatRequest;
		} else {
			// TODO: adjust temperature and topK
			const ociMessages = messages.map(_toOciGenericApiMessage).flat();
			chatRequest = {
				apiFormat: 'GENERIC',
				messages: ociMessages,
				temperature: this.temperature,
				topP: this.topP,
				topK: this.model.startsWith('meta') && this.topK == 0 ? -1 : this.topK,
				maxTokens: this.maxTokens,
				frequencyPenalty: this.frequencyPenalty,
				presencePenalty: this.presencePenalty,
				tools: this.tools
			} as models.GenericChatRequest;
		}

		const chatDetails: models.ChatDetails = {
			compartmentId: this.compartmentId,
			servingMode: {
				servingType: 'ON_DEMAND',
				modelId: this.model,
			},
			chatRequest: chatRequest,
		};
		const response = await this.client.chat({ chatDetails }) as ChatResponse;

		let text: string;
		let toolCalls: ToolCall[] | undefined;

		if (response.chatResult.chatResponse.apiFormat === 'COHERE') {
			const cohereResponse = response.chatResult.chatResponse as models.CohereChatResponse;

			toolCalls = cohereResponse.toolCalls?.map((toolCall) => {
				return {
					name: toolCall.name,
					args: toolCall.parameters,
					id: toolCall.name,
					type: "tool_call"
				} as ToolCall
			});
			text = cohereResponse.text;
		} else {
			const genericResponse = response.chatResult.chatResponse as models.GenericChatResponse;
			const choice = genericResponse.choices.at(0);
			const assistantMessage = choice?.message as model.AssistantMessage

			toolCalls = assistantMessage?.toolCalls?.filter((toolCall) => toolCall).map((toolCall: model.FunctionCall) => {
				const args: Record<string, any> = JSON.parse(toolCall.arguments || "");
				return {
					name: toolCall.name,
					args,
					id: toolCall.id,
					type: "tool_call"
				} as ToolCall
			})
			text = choice?.message?.content?.map((c) => (c as models.TextContent).text).join('') || '';
			// toolCalls = choice?.message?.
			// toolCalls = choice.message.toolCalls as ToolCall[];
		}

		return {
			generations: [
				{
					text,
					message: new AIMessage({
						content: text,
						tool_calls: toolCalls,
					}),
				},
			],
		};
	}
}
