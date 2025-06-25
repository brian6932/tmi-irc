import { EventEmitter } from 'tseep'
import { privmsgCommands } from './notices.js'
import { TimeoutError } from './errors.js'
import { RoomTracker } from './room.js'
import { Config } from './config.js'
import { /*DedicatedReadOnlyConnection,*/ ReadOnlyConnection, WriteOnlyConnection, ReadWriteConnection } from './connections.js'
import { hashtag, lf, comma } from './characters.js'

const
	// +100ms because js timers are inaccurate
	AUTHENTICATION_LIMIT_MS = 10_100,
	AUTHENTICATION_ATTEMPT_LIMIT = 20

/**
 * @constructor
 * @type {import('./index.d.ts').Client}
 */
export const Client = (config = new Config) => {
	if (Object.getPrototypeOf(config) !== Config.prototype)
		Object.setPrototypeOf(config, Config.prototype)

	const
		emitter = new EventEmitter,
		authenticated = config.pass.length === 30,

		cap = `cap REQ :twitch.tv/tags`
			+ (config.commandsCapability ? ` twitch.tv/commands` : ``)     // Enabled by default
			+ (config.membershipCapability ? ` twitch.tv/membership` : ``) // Disabled by default
			+ `\n`,
		nick = `nick ${config.nick = authenticated ? `_` : `justinfan` + Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)}\n`


	emitter.rooms = new RoomTracker

	let
		// The password token's 30 bytes + ((a leading `pass oauth:`.length === 11 bytes) + (a trailing `\n` === 1 byte) = 12 bytes) = 42 bytes
		initBuffer = Buffer.allocUnsafe(authenticated * 12 + config.pass.length + cap.length + nick.length),
		initBufferOffset = initBuffer.write(cap)

	if (authenticated) {
		initBufferOffset += initBuffer.write(`pass oauth:${config.pass}\n`, initBufferOffset)
		emitter.once(`NOTICE`, notice => {
			const message = notice.message?.toString()
			if (message === `Login authentication failed`)
				throw Error(message)
		})
	}

	initBufferOffset += initBuffer.write(nick, initBufferOffset)

	initBuffer = initBuffer.subarray(undefined, initBufferOffset)

	let
		first = true,
		reconnecting = false

	emitter.unjoinableChannels = new Set
	emitter.failSize = undefined

	emitter
		.on(`NOTICE`, notice => {
			switch (notice[`msg-id`]) {
				case `msg_banned`:
				case `msg_channel_suspended`:
					emitter.unjoinableChannels.add(notice.channel)
			}
		})
		.on(`JOIN`, (join, connection) => {
			if (join.login !== config.nick)
				return

			++connection.channelLength
			emitter.rooms.set(join.channel, connection)
		})
		.on(`PART`, (part, connection) => {
			if (part.login !== config.nick)
				return

			--connection.channelLength
			emitter.rooms.delete(part.channel)
		})

	const ReadConnection = config.mergeConnections && authenticated ? ReadWriteConnection : ReadOnlyConnection
	emitter.connect = async () => {
		if (!reconnecting) {
			if (first && authenticated) {
				emitter.once(`001`, _ => config.nick = _.login)
				first = false
			}
			emitter.config = config
		}

		let
			ready,
			limits

		emitter.connections = config.mergeConnections
			? new function () {
				Object.setPrototypeOf(this, null)

				config.readDivisor = +(config.readDivisor <= 0) || config.readDivisor

				this.read
					= this.write
					= Array(Math.ceil((reconnecting ? emitter.rooms.size : config.channels.size) / config.readDivisor))

				ready = Array(this.read.length)

				if (authenticated && config.rateLimit) {
					// https://dev.twitch.tv/docs/chat/#rate-limits
					let
						limit = 0,
						limiter = 0,
						readyStart = 0

					limits = Array(Math.ceil(this.read.length / AUTHENTICATION_ATTEMPT_LIMIT))

					const limitIterator = limits.keys()

					for (const i of this.read.keys()) {
						const readyIndex = readyIterator.next().value
						ready[readyIndex] = new Promise(resolve => {
							setTimeout(() => resolve((this.read[i] = new ReadConnection(initBuffer, config, emitter)).ready), limit * AUTHENTICATION_LIMIT_MS)
						})
						if (++limiter === AUTHENTICATION_ATTEMPT_LIMIT) {
							limits[limitIterator.next().value] = Promise.all(ready.slice(readyStart, readyStart = readyIndex + 1))
							limiter = 0
							++limit
						}
					}

					if (limiter !== 0)
						limits[limitIterator.next().value] = Promise.all(ready.slice(readyStart, ready.length))
				}
				else
					for (const i of this.read.keys())
						ready[i] = (this.read[i] = new ReadConnection(initBuffer, config, emitter)).ready
			}
			: new function () {
				Object.setPrototypeOf(this, null)

				const size = reconnecting ? emitter.rooms.size : config.channels.size

				// Unauthenticated users can't have write connections
				config.writeMultiplier = (config.writeMultiplier >= 0) * config.writeMultiplier * authenticated
				this.write = Array(Math.ceil((size || 1) * config.writeMultiplier))

				config.readDivisor = +(config.readDivisor <= 0) || config.readDivisor
				this.read = Array(Math.ceil(size / config.readDivisor))

				const connectionLength = this.write.length + this.read.length
				ready = Array(connectionLength)
				const readyIterator = ready.keys()

				if (authenticated && config.rateLimit) {
					// https://dev.twitch.tv/docs/chat/#rate-limits
					let
						limit = 0,
						limiter = 0,
						readyOffset = 0

					limits = Array(Math.ceil(connectionLength / AUTHENTICATION_ATTEMPT_LIMIT))
					const
						limitIterator = limits.keys(),
						limitConnections = (connectionType, ConnectionConstructor) => {
							for (const i of this[connectionType].keys()) {
								const readyIndex = readyIterator.next().value
								ready[readyIndex] = new Promise(resolve => {
									setTimeout(() => resolve((this[connectionType][i] = new ConnectionConstructor(initBuffer, config, emitter)).ready), limit * AUTHENTICATION_LIMIT_MS)
								})
								if (++limiter === AUTHENTICATION_ATTEMPT_LIMIT) {
									limits[limitIterator.next().value] = Promise.all(ready.slice(readyOffset, readyOffset = readyIndex + 1))
									limiter = 0
									++limit
								}
							}
						}

					limitConnections(`read`, ReadOnlyConnection)
					limitConnections(`write`, WriteOnlyConnection)

					if (limiter !== 0)
						limits[limitIterator.next().value] = Promise.all(ready.slice(readyOffset, ready.length))
				}
				else {
					for (const i of this.read.keys())
						ready[readyIterator.next().value] = (this.read[i] = new ReadOnlyConnection(initBuffer, config, emitter)).ready
					for (const i of this.write.keys())
						ready[readyIterator.next().value] = (this.write[i] = new WriteOnlyConnection(initBuffer, config, emitter)).ready
				}
			}

		const
			writeOnly = emitter.connections.read.length === 0 && emitter.connections.write.length >= 1,
			readOnly = emitter.connections.write.length === 0 && emitter.connections.read.length >= 1
		if (writeOnly)
			/**
			 * Write-only mode specific method.
			 *
			 * Allows you to reallocate your connection size.
			 * @param {number} size New connection size
			 */
			emitter.resize = size => {
				if (size < 0)
					throw RangeError(`Size can't be negative, received ${size}`)

				if (size === emitter.connections.write.length)
					return

				config.writeMultiplier = size

				if (size > emitter.connections.write.length) {
					let i = emitter.connections.write.length
					emitter.connections.write.length = size

					while (size > i)
						emitter.connections.write[i++] = new WriteOnlyConnection(initBuffer, config, emitter)

					return
				}

				let i = emitter.connections.read.length

				while (size !== i)
					emitter.connections.write[--i].destroy()

				emitter.connections.length = size
			}
		else {
			let roomMutatorIndex = -1

			/**
			 * If a Set is provided, it'll be mutated, Strings and Arrays won't.
			 * @return Returns undefined when all channels are within `this.joinedChannels`.
			 * @type   {(type: `join`|`part`) => (channels: string|string[]|Set<string>) => Promise<undefined|TimeoutError|TypeError>}
			 */
			const roomMutator = type => channels => new Promise(async (resolve, reject) => {
				switch (channels.constructor) {
					case Set:
						break
					case Array:
						channels = new Set(channels)
						break
					case String:
						channels = new Set().add(channels)
						break
					case RoomTracker:
						channels = new Set(channels.keys())
						if (type === `join`)
							emitter.rooms.clear()
						break
					default:
						return reject(TypeError())
				}

				for (const channel of emitter.unjoinableChannels)
					channels.delete(channel)

				const
					parting = type === `part`,
					// Channel/user names can only be ascii
					encoding = `ascii`

				if (parting) {
					for (const channel of channels) {
						const connection = emitter.rooms.get(channel)

						if (connection === undefined) {
							channels.delete(channel)
							continue
						}

						await connection.ready

						connection.socket.write(`${type} #${channel}\n`, encoding)
					}
				}
				else {

					for (const channel of emitter.rooms.keys())
						channels.delete(channel)

					const
						roomSize = channels.size + emitter.rooms.size,
						divisor = config.readDivisor

					let readSize = Math.ceil(roomSize / divisor)

					if (readSize > emitter.connections.read.length) {
						let i = emitter.connections.read.length
						emitter.connections.read.length = readSize

						while (readSize > i)
							emitter.connections.read[i++] = new ReadConnection(initBuffer, config, emitter)
					}

					if (!config.mergeConnections) {
						let writeSize = Math.ceil(roomSize * config.writeMultiplier)

						if (writeSize > emitter.connections.write.length) {
							let i = emitter.connections.write.length
							emitter.connections.write.length = writeSize

							while (writeSize > i)
								emitter.connections.write[i++] = new WriteOnlyConnection(initBuffer, config, emitter)
						}
					}

					let size = channels.size
					const
						// The max length of a username can be's 25 bytes + (a leading `join #`.length === 6 bytes) + (a trailing `\n` === 1 byte) = 32 bytes
						// When joining multiple channels, we can comma seperate each, so 25 bytes + (a leading `,#`.length === 2 bytes) = 27 bytes
						buffer = Buffer.allocUnsafe((size > 0) * 32 + (size > 1) * (divisor - 1) * 27),
						channelIterator = channels.values()

					joiner:
					while (size > 0) {
						let connection, remainder, index

						do {
							index = ++roomMutatorIndex % readSize
							connection = emitter.connections.read[index]
							await connection.ready
							remainder = divisor - connection.channelLength
						}
						while (remainder < 1)

						let offset = buffer.write(`${type} #`, encoding)

						for (;;) {
							const channel = channelIterator.next().value

							if (channel === undefined)
								break joiner

							--size
							--remainder

							/*
							Checking for duplicate channels used to be done here, but it wasn't worth the allocation overhead.
							const joined = emitter.rooms.has(channel)

							if (joined) {
								channels.delete(channel)
								continue
							}
							*/

							offset += buffer.write(channel, offset, encoding)

							if (size === 0 || remainder === 0)
								break

							offset = buffer.writeUint8(hashtag, buffer.writeUint8(comma, offset))
						}

						connection.socket.write(buffer.subarray(undefined, buffer.writeUint8(lf, offset)))
					}
				}


				if (channels.size === 0) {

					return resolve()
				}

				const
					event = type.toUpperCase(),
					listener = room => {
						channels.delete(room.channel)

						if (channels.size !== 0)
							return

						emitter.removeListener(event, listener)
						return resolve()
					}
				emitter.on(event, listener)

				/*
				setTimeout(() => {
					emitter.removeListener(event, listener)

					// Renamed or never created channels won't return a NOTICE,
					// so multiple attempts will be required in these specific cases
					if (emitter.failSize === channels.size && --attempts !== 0) {
						// if (!parting)
						// for (const connection of pendingConnections)
						// connection.pending = 0

						attempts = 5
						emitter.failSize = undefined
						return reject(channels)
					}

					emitter.failSize = channels.size
					// sequence = emitter[parting ? `part` : `join`](channels)
					emitter[parting ? `part` : `join`](channels, 0)
				}, 10_500)
				*/
			})

			/**
			 * JOINs a channel.
			 */
			emitter.join = roomMutator(`join`)
			/**
			 * PARTs (leaves) a channel.
			 */
			emitter.part = roomMutator(`part`)

			emitter.join(reconnecting ? emitter.rooms : config.channels)
		}


		if (authenticated && (config.writeMultiplier > 0 || config.mergeConnections)) {
			let privmsgConnectionIndex = -1
			// These are currently intentionally not promisified for performance
			// I'm not opposed to adding promisified versions with USERSTATE events
			// But the base versions absolutely won't be
			for (const key of [`writeRaw`, `privmsg`, `privmsgTS`, `reply`, `replyTS`])
				emitter[key] = function () {
					return emitter.connections.write[++privmsgConnectionIndex % emitter.connections.write.length | 0][key](...arguments)
				}
			for (const key in privmsgCommands)
				emitter[key] = function () {
					return emitter.connections.write[++privmsgConnectionIndex % emitter.connections.write.length | 0][key](config, emitter, ...arguments)
				}
		}

		let
			pingReadIndex = -1,
			pingWriteIndex = -1
		emitter.ping = () => {
			if (writeOnly || config.mergeConnections)
				return emitter.connections.write[++pingWriteIndex % emitter.connections.write.length].ping()
			else if (readOnly)
				return emitter.connections.read[++pingReadIndex % emitter.connections.read.length].ping()

			return (Math.random() > emitter.connections.read.length / (emitter.connections.read.length + emitter.connections.write.length)
				? emitter.connections.write[++pingWriteIndex % emitter.connections.write.length]
				: emitter.connections.read[++pingReadIndex % emitter.connections.read.length]
			).ping()
		}

		emitter.closed = 0
		emitter.close = () => {
			for (const connection of emitter.connections.read)
				connection.socket.destroySoon()
			if (!config.mergeConnections)
				for (const connection of emitter.connections.write)
					connection.socket.destroySoon()
		}

		process
			.once(`SIGINT`, emitter.close)
			.once(`SIGTERM`, emitter.close)

		emitter.once(`RECONNECT`, () => {
			console.warn(`RECONNECT received`)
			// Sometimes reconencts get sent multiple times in a row,
			// this causes loads of problems when dealing with rate limits,
			// to counteract this, we reconnect with the authentication limit's delay.
			setTimeout(() => {
				console.warn(`RECONNECTING...`)
				emitter.close()
				reconnecting = true

				emitter.connect()
			}, AUTHENTICATION_LIMIT_MS)
		})

		await Promise.all(config.rateLimit ? limits : ready)
	}
	return emitter
}
