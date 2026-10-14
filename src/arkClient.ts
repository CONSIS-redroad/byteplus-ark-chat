/**
 * Klient HTTP do BytePlus ModelArk (dowolny endpoint OpenAI-compatible).
 *
 * Zapytanie buduje wtyczka, wiec naglowek Authorization ustawiamy sami. To jest
 * kluczowa roznica wobec dostawcy BYOK "Custom Endpoint", ktory ustawia ten naglowek
 * na sztywno ("Bearer <klucz grupy>"), a pole requestHeaders filtruje lista
 * _reservedHeaders (authorization, api-key, content-type).
 */

export interface ArkToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

export interface ArkToolDef {
	type: 'function';
	function: { name: string; description?: string | undefined; parameters?: object | undefined };
}

export interface ArkMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | null;
	tool_call_id?: string;
	tool_calls?: ArkToolCall[];
}

export interface ArkUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
}

export interface ArkChatRequest {
	baseUrl: string;
	apiKey?: string | undefined;
	model: string;
	messages: ArkMessage[];
	tools?: ArkToolDef[];
	toolMode?: 'auto' | 'required';
	maxTokens?: number;
	temperature?: number;
	timeoutMs: number;
	signal?: AbortSignal | undefined;
	onText: (text: string) => void;
	onToolCall: (callId: string, name: string, input: object) => void;
	onUsage?: ((usage: ArkUsage) => void) | undefined;
}

export class ArkHttpError extends Error {
	constructor(readonly status: number, readonly body: string) {
		super('HTTP ' + status + ': ' + body);
		this.name = 'ArkHttpError';
	}
}

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function endpoint(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '') + '/chat/completions';
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export function estimateTokens(text: string): number {
	return Math.max(1, Math.ceil(text.length / 4));
}

/** Wysyla zapytanie, ponawiajac tylko bledy przejsciowe (429, 5xx). */
export async function sendChatRequest(req: ArkChatRequest): Promise<void> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			await onceChatRequest(req);
			return;
		} catch (err) {
			const retryable = err instanceof ArkHttpError && RETRYABLE.has(err.status);
			if (!retryable || attempt >= 2 || req.signal?.aborted) {
				throw err;
			}
			await delay(500 * (attempt + 1));
		}
	}
}

async function onceChatRequest(req: ArkChatRequest): Promise<void> {
	const body: Record<string, unknown> = {
		model: req.model,
		messages: req.messages,
		stream: true
	};
	if (req.maxTokens) {
		body.max_tokens = req.maxTokens;
	}
	if (typeof req.temperature === 'number') {
		body.temperature = req.temperature;
	}
	if (req.tools && req.tools.length > 0) {
		body.tools = req.tools;
		body.tool_choice = req.toolMode === 'required' ? 'required' : 'auto';
	}

	const headers: Record<string, string> = {
		'content-type': 'application/json',
		accept: 'text/event-stream'
	};
	if (req.apiKey) {
		headers.authorization = 'Bearer ' + req.apiKey;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), req.timeoutMs);
	const onAbort = (): void => controller.abort();
	req.signal?.addEventListener('abort', onAbort);

	try {
		const res = await fetch(endpoint(req.baseUrl), {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal: controller.signal
		});
		if (!res.ok) {
			throw new ArkHttpError(res.status, await readErrorBody(res));
		}
		const contentType = res.headers.get('content-type') ?? '';
		if (contentType.includes('text/event-stream')) {
			await readStream(res, req);
			return;
		}
		const text = await res.text();
		const pending = new Map<number, PendingCall>();
		try {
			consumeChunk(JSON.parse(text) as unknown, pending, req);
		} catch (err) {
			if (err instanceof ArkHttpError) {
				throw err;
			}
			throw new Error('Nieoczekiwana odpowiedz ARK (nie SSE i nie JSON): ' + text.slice(0, 300));
		}
		flushToolCalls(pending, req);
	} finally {
		clearTimeout(timer);
		req.signal?.removeEventListener('abort', onAbort);
	}
}

interface PendingCall {
	id: string;
	name: string;
	args: string;
}

async function readStream(res: Response, req: ArkChatRequest): Promise<void> {
	if (!res.body) {
		throw new Error('ARK nie zwrocilo tresci strumienia (response.body = null)');
	}
	const reader = res.body.getReader();
	const decoder = new TextDecoder('utf-8');
	const pending = new Map<number, PendingCall>();
	let buffer = '';
	for (;;) {
		const chunk = await reader.read();
		if (chunk.done) {
			break;
		}
		buffer += decoder.decode(chunk.value, { stream: true });
		let nl = buffer.indexOf('\n');
		while (nl >= 0) {
			const line = buffer.slice(0, nl).replace(/\r$/, '').trim();
			buffer = buffer.slice(nl + 1);
			nl = buffer.indexOf('\n');
			if (line.length === 0 || line.startsWith(':') || !line.startsWith('data:')) {
				continue;
			}
			const payload = line.slice(5).trim();
			if (payload === '[DONE]') {
				flushToolCalls(pending, req);
				return;
			}
			try {
				consumeChunk(JSON.parse(payload) as unknown, pending, req);
			} catch {
				/* niepelny albo nieznany fragment - pomijamy */
			}
		}
	}
	flushToolCalls(pending, req);
}

function consumeChunk(json: unknown, pending: Map<number, PendingCall>, req: ArkChatRequest): void {
	const obj = json as {
		usage?: ArkUsage;
		choices?: Array<{ delta?: Record<string, unknown>; finish_reason?: string | null }>;
	};
	if (obj.usage) {
		req.onUsage?.(obj.usage);
	}
	for (const choice of obj.choices ?? []) {
		const delta = choice.delta ?? {};
		const content = delta.content;
		if (typeof content === 'string' && content.length > 0) {
			req.onText(content);
		} else if (Array.isArray(content)) {
			for (const part of content) {
				const text = (part as { text?: unknown }).text;
				if (typeof text === 'string') {
					req.onText(text);
				}
			}
		}
		const toolCalls = delta.tool_calls;
		if (Array.isArray(toolCalls)) {
			for (const raw of toolCalls) {
				const call = raw as {
					index?: number;
					id?: string;
					function?: { name?: string; arguments?: string };
				};
				const index = typeof call.index === 'number' ? call.index : 0;
				const entry = pending.get(index) ?? { id: '', name: '', args: '' };
				if (call.id) {
					entry.id = call.id;
				}
				if (call.function?.name) {
					entry.name = call.function.name;
				}
				if (typeof call.function?.arguments === 'string') {
					entry.args += call.function.arguments;
				}
				pending.set(index, entry);
			}
		}
		if (choice.finish_reason === 'tool_calls') {
			flushToolCalls(pending, req);
		}
	}
}

function flushToolCalls(pending: Map<number, PendingCall>, req: ArkChatRequest): void {
	if (pending.size === 0) {
		return;
	}
	const entries = [...pending.entries()].sort((a, b) => a[0] - b[0]);
	pending.clear();
	for (const [index, entry] of entries) {
		if (!entry.name) {
			continue;
		}
		let input: object = {};
		const raw = entry.args.trim();
		if (raw.length > 0) {
			try {
				const parsed = JSON.parse(raw) as unknown;
				input = parsed && typeof parsed === 'object' ? (parsed as object) : { value: parsed };
			} catch {
				input = { _raw: raw };
			}
		}
		req.onToolCall(entry.id || 'call_' + index + '_' + Date.now(), entry.name, input);
	}
}

async function readErrorBody(res: Response): Promise<string> {
	try {
		const text = await res.text();
		try {
			const json = JSON.parse(text) as { error?: { message?: string }; message?: string };
			const msg = json.error?.message ?? json.message;
			if (msg) {
				return msg;
			}
		} catch {
			/* odpowiedz nie jest JSON-em - zwracamy surowy tekst */
		}
		return text.replace(/\s+/g, ' ').slice(0, 800);
	} catch {
		return '(brak tresci odpowiedzi)';
	}
}
