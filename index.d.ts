// OUT OF DATE
import { TLSSocket } from 'node:tls'

type CAP = {
	capabilities: (string | Buffer)[]
}

type PRIVMSG_WHISPER = {
	badges: Record<string, number | Record<string, number>>
	color: number | null
	'display-name': string | Buffer
	emotes: string | Buffer
	turbo: 0 | 1
	'user-id': number
	'user-type': string | Buffer
	login: string
}

type PRIVMSG_USERNOTICE = {
	'msg-id': string | Buffer
	badges: Record<string, number | Record<string, number>>
	'badge-info': Record<string, number | Record<string, string | Buffer>>
	color: number | null
	'display-name': string | Buffer
	emotes: string | Buffer
	flags: string | Buffer
	id: string | Buffer
	mod: 0 | 1
	'room-id': number
	subscriber: 0 | 1
	'tmi-sent-ts': number
	'user-id': number
	'user-type': string | Buffer
	login: string
	channel: string
}

type KnownCommands = {
	'001': {
		login: string
		message: string | Buffer
	}
	'002': KnownCommands['001']
	'003': KnownCommands['001']
	'004': KnownCommands['001']
	'353': KnownCommands['366']
	'366': KnownCommands['001'] & {
		channel: string
	}
	'372': KnownCommands['001']
	'375': KnownCommands['001']
	'376': KnownCommands['001']
	'421': KnownCommands['001'] & {
		failed: string | Buffer
	}
	'CAP * ACK': {
		capabilities: (string | Buffer | never)[]
	}
	'CAP * NAK': CAP
	'CAP * LS': CAP
	CLEARCHAT: {
		'ban-duration': number
		'room-id': number
		'target-user-id': number
		'tmi-sent-ts': number
		channel: string
		login: string
	}
	CLEARMSG: {
		login: string
		'room-id': number
		'tmi-sent-ts': number
		'target-msg-id': string | Buffer
	}
	HOSTTARGET: {
		channel: string
		hosting: string | Buffer
		viewers: number
	}
	JOIN: {
		channel: string
		login: string
	}
	NOTICE: {
		'msg-id'?: string // Not present on * NOTICEs (Login authentication failed)
		message?: string | Buffer
		users?: string[] | Buffer[]
	}
	PART: KnownCommands['JOIN']
	PONG: {
		message?: string | Buffer
	}
	PRIVMSG: PRIVMSG_USERNOTICE & PRIVMSG_WHISPER & {
		'emote-only'?: 0 | 1
		'client-nonce'?: string | Buffer
		'first-msg': 0 | 1
		'reply-parent-display-name'?: string | Buffer
		'reply-parent-msg-body'?: string | Buffer
		'reply-parent-msg-id'?: string | Buffer
		'reply-parent-user-id'?: number
		'reply-parent-user-login'?: string | Buffer
		'sent-ts'?: number
		action: boolean
	}
	RECONNECT: {}
	ROOMSTATE: {
		'emote-only': 0 | 1
		'followers-only': number
		r9k: 0 | 1
		rituals: number
		slow: number
		'subs-only': 0 | 1
		channel: string
	}
	USERNOTICE: PRIVMSG_USERNOTICE & {
		'system-msg': string | Buffer
		'msg-param-multimonth-duration'?: number
		'msg-param-multimonth-tenure'?: number
		'msg-param-should-share-streak'?: number
		'msg-param-sub-plan'?: number
		'msg-param-cumulative-months'?: number
		'msg-param-donation-amount'?: number
		'msg-param-exponent'?: number
		'msg-param-gift-months'?: number
		'msg-param-mass-gift-count'?: number
		'msg-param-months'?: number
		'msg-param-recipient-id'?: number
		'msg-param-streak-months'?: number
		'msg-param-viewerCount'?: number
		'msg-param-goal-current-contributions'?: number
		'msg-param-goal-target-contributions'?: number
		'msg-param-goal-user-contributions'?: number
	}
	USERSTATE: Omit<Omit<KnownCommands['PRIVMSG'], 'action'>, 'first-msg'> & {
		'emote-sets'?: (string | Buffer)[]
	}
	WHISPER: PRIVMSG_WHISPER & {
		'thread-id': string | Buffer
		'message-id': number
	}
}

type CommandParserForCommand<T extends keyof KnownCommands> = CommandParser & Commands[T]

type C = KnownCommands & {
	[T in keyof KnownCommands]: [CommandParserForCommand<T> & { command: T }]
}

export type Commands = C

export interface CommandParser {
	new(buffer: Buffer):
		Partial<C['001']> &
		Partial<C['002']> &
		Partial<C['003']> &
		Partial<C['004']> &
		Partial<C['353']> &
		Partial<C['366']> &
		Partial<C['372']> &
		Partial<C['375']> &
		Partial<C['376']> &
		Partial<C['421']> &
		Partial<C['CAP * ACK']> &
		Partial<C['CAP * NAK']> &
		Partial<C['CAP * LS']> &
		Partial<C['CLEARCHAT']> &
		Partial<C['CLEARMSG']> &
		Partial<C['HOSTTARGET']> &
		Partial<C['JOIN']> &
		Partial<C['NOTICE']> &
		Partial<C['PART']> &
		Partial<C['PONG']> &
		Partial<C['PRIVMSG']> &
		Partial<C['ROOMSTATE']> &
		Partial<C['RECONNECT']> &
		Partial<C['USERNOTICE']> &
		Partial<C['USERSTATE']> &
		Partial<C['WHISPER']> & {
			command: keyof C
		}
}

declare namespace EventEmitter {
	interface ListenerFn<Args extends any[] = any[]> {
		(...args: Args): void
	}

	interface EventEmitterStatic {
		new <
			EventTypes extends ValidEventTypes = string | symbol,
			Context = any
		>(): typeof EventEmitter<EventTypes, Context>
	}

	/**
	 * `object` should be in either of the following forms:
	 * ```
	 * interface EventTypes {
	 *   'event-with-parameters': any[]
	 *   'event-with-example-handler': (...args: any[]) => void
	 * }
	 * ```
	 */
	type ValidEventTypes = string | symbol | object

	type EventNames<T extends ValidEventTypes> = T extends string | symbol
		? T
		: keyof T

	type ArgumentMap<T extends object> = {
		[K in keyof T]: T[K] extends (...args: any[]) => void
		? Parameters<T[K]>
		: T[K] extends any[]
		? T[K]
		: any[]
	}

	type EventListener<
		T extends ValidEventTypes,
		K extends EventNames<T>
	> = T extends string | symbol
		? (...args: any[]) => void
		: (
			...args: ArgumentMap<Exclude<T, string | symbol>>[Extract<K, keyof T>]
		) => void

	type EventArgs<
		T extends ValidEventTypes,
		K extends EventNames<T>
	> = Parameters<EventListener<T, K>>

	const EventEmitter: EventEmitterStatic
}

type TMIEvent = {
	[T in keyof C]: [CommandParserForCommand<T>]
}


export interface Client {
	new(config?: Object): Client
	joinedChannels: Set<string>
	privmsg: (channel: string, message: string) => boolean
	join: (channels: string | string[] | Set<string>) => Promise<Boolean | Error | TypeError>
	part: (channels: string | string[] | Set<string>) => Promise<Boolean | Error | TypeError>
	ping: () => Promise<number>
	on<T extends EventEmitter.EventNames<TMIEvent>>(
		event: T,
		fn: EventEmitter.EventListener<TMIEvent, T>,
	): this
	once<T extends EventEmitter.EventNames<TMIEvent>>(
		event: T,
		fn: EventEmitter.EventListener<TMIEvent, T>,
	): this
	removeListener<T extends EventEmitter.EventNames<TMIEvent>>(
		event: T,
		fn?: EventEmitter.EventListener<TMIEvent, T>,
		once?: boolean
	): this
}
