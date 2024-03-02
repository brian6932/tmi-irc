import { EventEmitter } from 'tseep'
import { privmsgCommands } from './notices.js'
import { TimeoutError } from './errors.js'
import { RoomTracker } from './room.js'
import { Config } from './config.js'
import { ReadOnlyConnection, WriteOnlyConnection, ReadWriteConnection } from './connections.js'
import { hashtag, lf, comma } from './characters.js'

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

	const
		ReadConnection = config.mergeConnections && authenticated ? ReadWriteConnection : ReadOnlyConnection,
		roomListener = () => emitter
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

	emitter.connect = async () => {
		if (!reconnecting) {
			if (first && authenticated)
				emitter.once(`001`, _ => config.nick = _.login)
			emitter.config = config
		}

		let ready
		emitter.connections = config.mergeConnections
			? new function () {
				Object.setPrototypeOf(this, null)
				roomListener()

				config.readDivisor = (config.readDivisor <= 0) * 1 || config.readDivisor

				this.read
					= this.write
					= Array(Math.ceil((reconnecting ? emitter.rooms.size : config.channels.size) / config.readDivisor))

				ready = Array(this.read.length)

				for (const i of this.read.keys())
					ready[i] = (this.read[i] = new ReadConnection(initBuffer, config, emitter)).ready
			}
			: new function () {
				Object.setPrototypeOf(this, null)

				const size = reconnecting ? emitter.rooms.size : config.channels.size

				// Unauthenticated users can't have write connections
				config.writeMultiplier = (config.writeMultiplier >= 0) * config.writeMultiplier * authenticated
				this.write = Array(Math.ceil(size || 1 * config.writeMultiplier))

				config.readDivisor = (config.readDivisor <= 0) * 1 || config.readDivisor
				if ((this.read = Array(Math.ceil(size / config.readDivisor))).length !== 0)
					roomListener()

				ready = Array(this.write.length + this.read.length)
				const itr = ready.keys()

				for (const i of this.read.keys())
					ready[itr.next().value] = (this.read[i] = new ReadOnlyConnection(initBuffer, config, emitter)).ready
				for (const i of this.write.keys())
					ready[itr.next().value] = (this.write[i] = new WriteOnlyConnection(initBuffer, config, emitter)).ready
			}

		if (emitter.connections.read.length === 0 && emitter.connections.write.length >= 1)
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
			let roomMuatatorIndex = -1
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
						channels = new Set(...channels.keys())
						break
					default:
						return reject(TypeError())
				}

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
					let readSize = Math.ceil((channels.size + emitter.rooms.readSize) / config.readDivisor)

					while (readSize > emitter.connections.read.length)
						emitter.connections.read[emitter.connections.read.length] = new ReadConnection(initBuffer, config, emitter)

					if (!config.mergeConnections) {
						let writeSize = Math.ceil((channels.size + emitter.rooms.writeSize) * config.writeMultiplier)
						while (writeSize > emitter.connections.write.length)
							emitter.connections.write[emitter.connections.write.length] = new WriteOnlyConnection(initBuffer, config, emitter)
					}

					let channelsPerConnection = Math.ceil(channels.size / config.readDivisor)
					// clamps
					channelsPerConnection = (channelsPerConnection > config.readDivisor) * config.readDivisor + (channelsPerConnection < config.readDivisor) * channelsPerConnection
					const
						// The max length of a username can be's 25 bytes + (a leading `join #`.length === 6 bytes) + (a trailing `\n` === 1 byte) = 32 bytes
						// When joining multiple channels, we can comma seperate each, so 25 bytes + (a leading `,#`.length === 2 bytes) = 27 bytes
						buffer = Buffer.allocUnsafe((channels.size > 0) * 32 + (channelsPerConnection > 1) * (channelsPerConnection - 1) * 27),
						itr = channels.values()
					let size = channels.size

					joiner:
					while (--size > -1) {
						let connectionIndex, channelLength

						do channelLength = emitter.connections.read[connectionIndex = ++roomMuatatorIndex % emitter.connections.read.length | 0].channelLength + channelsPerConnection
						while (channelLength > config.readDivisor)

						let offset = buffer.write(`${type} #`, encoding)

						let i = 0
						for (;;) {
							const channel = itr.next().value

							if (channel === undefined)
								break joiner

							const joined = emitter.rooms.has(channel)

							if (joined) {
								channels.delete(channel)
								continue
							}

							offset += buffer.write(channel, offset, encoding)

							if (++i === channelsPerConnection)
								break

							offset = buffer.writeUint8(hashtag, buffer.writeUint8(comma, offset))
						}

						const connection = emitter.connections.read[connectionIndex]

						await connection.ready
						// For some reason using the raw buffer here results in encoding issues (421s sent back due to early newlines)
						// bug with node.js writables maybe
						connection.socket.write(buffer.toString(encoding, undefined, buffer.writeUint8(lf, offset)), encoding)
					}
				}


				if (channels.size === 0)
					return resolve()

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

				setTimeout(() => {
					emitter.removeListener(event, listener)

					let stringChannels = ``
					for (const channel of channels)
						stringChannels += ` ` + channel

					return reject(new TimeoutError(`Timeout exceeded ${type}ing:${stringChannels}`))
				}, 180_000)
				// config.promiseTimeout * channels.size
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


		if (authenticated && emitter.connections.write.length >= 1) {
			let privmsgConnectionIndex = -1
			// These are currently intentionally not promisified for performance
			// I'm not opposed to adding promisified versions with USERSTATE events
			// But the base versions absolutely won't be
			for (const key of [`privmsg`, `privmsgTS`, `reply`, `replyTS`])
				emitter[key] = function () {
					return emitter.connections.write[++privmsgConnectionIndex % emitter.connections.write.length | 0][key](...arguments)
				}
			for (const key in privmsgCommands)
				emitter[key] = function () {
					return emitter.connections.write[++privmsgConnectionIndex % emitter.connections.write.length | 0][key](...arguments, config, emitter)
				}
		}

		emitter.ping = () => (emitter.connections.read[0] || emitter.connections.write[0]).ping()

		emitter.once(`RECONNECT`, () => {
			for (const i of emitter.connections.read.keys())
				emitter.connections.read[i].destroy()
			for (const i of emitter.connections.write.keys())
				emitter.connections.write[i].destroy()

			reconnecting = true
			emitter.connect()
		})

		await Promise.all(ready)
	}
	return emitter
}
