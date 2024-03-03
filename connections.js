import { TLSSocket } from 'node:tls'
import { privmsgCommands } from './notices.js'
import { TimeoutError } from './errors.js'
import { lf } from './characters.js'
import { CommandParser } from './parser.js'

const
	Connection = function (initBuffer, config, emitter) {
		const collect = Buffer.allocUnsafe(30_000)
		/** @type {TLSSocket} */
		this.socket = new TLSSocket
		this.ready = new Promise(resolve => this.socket.once(`data`, () => resolve()))
		this.ping = this.ping(config, emitter)
		let
			offset = 0,
			pingterval

		this.socket
			.setNoDelay()
			.on(`PING`, () => this.socket.write(`pong\n`, `ascii`))
			.once(`connect`, () => pingterval = setInterval(() => this.ping(), 300_000))
			.once(`close`, () => clearInterval(pingterval))
			.connect(6697, `irc.chat.twitch.tv`)
			.on(`data`, tmi => {
				if (tmi[tmi.length - 1] !== lf)
					return offset += tmi.copy(collect, offset)
				else if (offset !== 0) {
					tmi = collect.subarray(undefined, offset + tmi.copy(collect, offset))
					offset = 0
				}

				let parsedTMI = new CommandParser(tmi)
				emitter.emit(parsedTMI.command, parsedTMI, this)

				while (parsedTMI.subarray !== undefined) {
					parsedTMI = new CommandParser(parsedTMI.subarray)
					emitter.emit(parsedTMI.command, parsedTMI, this)
				}
			})
			.write(initBuffer)
	},
	noticeCheck = (command, prop, config, emitter, channel) => {
		return new Promise((resolve, reject) => {
			const
				event = `NOTICE`,
				/** @type {(notice: import('./index.d.ts').Commands['NOTICE'])} */
				listener = notice => {
					if (notice.channel === channel)
						return prop[notice['msg-id'].toString()]?.(notice, emitter, event, listener, resolve, reject, prop.delay)
				}
			emitter.on(event, listener)

			setTimeout(() => {
				emitter.removeListener(event, listener)

				return reject(new TimeoutError(command))
			}, config.promiseTimeout + prop.delay)
		})
	}
export const
	ReadOnlyConnection = function (initBuffer, config, emitter) {
		Connection.call(this, initBuffer, config, emitter)
	},
	WriteOnlyConnection = function (initBuffer, config, emitter) {
		Connection.call(this, initBuffer, config, emitter)
	},
	ReadWriteConnection = function (initBuffer, config, emitter) {
		Connection.call(this, initBuffer, config, emitter)
	}

Connection.prototype = {
	__proto__: null,
	/**
	 * @type {(config: string) => () => number}
	 * @returns Float delay in ms between you and TMI.
	 */
	ping: (config, emitter) => function () {
		return new Promise((resolve, reject) => {
			const
				event = `PONG`,
				// Due to concurrent connections a more accurate timestamp than `Date.now()` is required for hashing
				ts = performance.now(),
				listener = pong => {
					if (+pong.message.toString() !== ts)
						return

					emitter.removeListener(event, listener)
					return resolve(performance.now() - ts)
				}
			emitter.on(event, listener)

			this.socket.write(`ping ${ts}\n`, `ascii`)
			setTimeout(() => {
				emitter.removeListener(event, listener)

				return reject(new TimeoutError(`Timeout exceeded waiting for PONG`))
			}, config.promiseTimeout)
		})
	}
}

ReadOnlyConnection.prototype = {
	__proto__: null,
	...Connection.prototype,
	channelLength: 0,
	readPermission: true,
	writePermission: false,
}

WriteOnlyConnection.prototype = {
	__proto__: null,
	...Connection.prototype,
	readPermission: false,
	writePermission: true,

	/**
	 * @callback privmsg
	 * @param  {string}  channel
	 * @param  {string}  message
	 * @return {boolean} Returns `true` if the entire data was flushed successfully to the kernel buffer.
	 * Returns `false` if all or part of the data was queued in user memory.
	 */

	/**
	 * Sends a PRIVMSG, doesn't do character validation.
	 * @type {privmsg}
	 */
	privmsg: function (channel, message) {
		return this.socket.write(`privmsg #${channel} :${message}\n`)
	},
	/**
	 * Sends a PRIVMSG, with `Date.now()` set within the `sent-ts` tag, doesn't do character validation.
	 * @type {privmsg}
	 */
	privmsgTS: function (channel, message) {
		return this.socket.write(`@sent-ts=${Date.now()} privmsg #${channel} :${message}\n`)
	},

	/**
	 * @callback reply
	 * @param  {string}  channel
	 * @param  {string}  message
	 * @param  {string}  msgID   The `msg-id` tag of the message you're replying to.
	 * @return {boolean} Returns `true` if the entire data was flushed successfully to the kernel buffer.
	 * Returns `false` if all or part of the data was queued in user memory.
	 */

	/**
	 * Replies to a PRIVMSG, doesn't do character validation.
	 * @type {reply}
	 */
	reply: function (channel, message, msgID) {
		return this.socket.write(`@reply-parent-msg-id=${msgID} privmsg #${channel} :${message}\n`)
	},
	/**
	 * Replies to a PRIVMSG, and sets `Date.now()` within the `sent-ts` tag, doesn't do character validation.
	 * @type {reply}
	 */
	replyTS: function (channel, message, msgID) {
		return this.socket.write(`@sent-ts=${Date.now()} @reply-parent-msg-id=${msgID} privmsg #${channel} :${message}\n`)
	}
}

for (const command in privmsgCommands) {
	/**
	 * @param  {string} channel
	 * @return {Promise<PermissionError|Error|TimeoutError|undefined|(string|Buffer)[]>}
	 */
	const prop = privmsgCommands[command]

	// jump table switch
	// https://github.com/v8/v8/blob/0c9f9732d333d3f73d4eb01c80fc6a2904ed3cce/src/interpreter/bytecode-generator.cc#L2148-L2212
	switch (prop.jump) {
		case 0:
			/**
			 * @param {number|string} color
			 * @param {string}        [channel]
			 */
			WriteOnlyConnection.prototype[command] = (config, emitter, color, channel) => {
				channel ??= config.nick
				if (typeof color === `number`)
					color = `#` + (`0`.repeat(6 - (color = color.toString(16)).length) + color)

				this.privmsg(channel, `.${command} ${color}`)

				return noticeCheck(command, prop, config, emitter, channel)
			}
			continue
		case 1:
			// note to self, when making typings, give delete `msgID` as arg, and give the rest `login` as arg
			/**
			 * @param {string} channel
			 * @param {string} arg
			 */
			WriteOnlyConnection.prototype[command] = function (config, emitter, channel, arg) {
				this.privmsg(channel, `.${command} ${arg}`)

				return noticeCheck(command, prop, config, emitter, channel)
			}
			continue
		case 2:
			/**
			 * @param {string}        channel
			 * @param {string}        login
			 * @param {string|number} [duration]
			 * @param {string}        [reason]
			 */
			WriteOnlyConnection.prototype[command] = function (config, emitter, channel, login, duration = ``, reason = ``) {
				this.privmsg(channel, `.${command} ${login}${duration && ` ` + duration}${reason && ` ` + reason}`)

				return noticeCheck(command, prop, config, emitter, channel)
			}
			continue
		case 3:
			/**
			 * @param {string} channel
			 * @param {string} login
			 * @param {string} [reason]
			 */
			WriteOnlyConnection.prototype[command] = function (config, emitter, channel, login, reason = ``) {
				this.privmsg(channel, `.${command} ${login}${reason && ` ` + reason}`)

				return noticeCheck(command, prop, config, emitter, channel)
			}
			continue
		case 4:
			/**
			 * @param {string} channel
			 * @param {string} login
			 */
			WriteOnlyConnection.prototype[command] = function (config, emitter, channel, login) {
				const raid = `.${command} ${login}`

				// To get any response back, we have to send twice
				// socket also makes it impossible to tell if you misraid
				this.socket.cork()
				this.privmsg(channel, raid)
				this.privmsg(channel, raid)
				this.socket.uncork()

				return noticeCheck(command, prop, config, emitter, channel)
			}
			continue
		case 5:
			/**
			 * @param {string} channel
			 */
			WriteOnlyConnection.prototype[command] = function (config, emitter, channel) {
				const prefixedCommand = `.` + command

				// To get any response back (when not joined), we have to send twice
				this.socket.cork()
				this.privmsg(channel, prefixedCommand)
				this.privmsg(channel, prefixedCommand)
				this.socket.uncork()

				return noticeCheck(command, prop, config, emitter, channel)
			}
			continue
		case 6:
			/**
			 * Whispers a login.
			 * @param  {string} login
			 * @param  {string} message
			 * @param  {string} [channel]
			 * @return {Promise<undefined|Error>}
			 */
			WriteOnlyConnection.prototype[command] = function (config, emitter, login, message, channel) {
				return new Promise((resolve, reject) => {
					this.privmsg(channel ?? config.nick, `.${command} ${login} ${message}`)

					const
						event = `NOTICE`,
						/** @type {(notice: import('./index.d.ts').Commands['NOTICE'])} */
						listener = notice => prop[notice['msg-id'].toString()]?.(notice, emitter, event, listener, resolve, reject)
					emitter.on(event, listener)

					setTimeout(() => {
						emitter.removeListener(event, listener)

						return resolve()
					}, 100)
					// arbitrary timeout, there's no actual way to verify whether a whisper sent (outside of using pubsub)
				})
			}
			continue
		case 7:
			/**
			 * Sends an announcement.
			 * @param  {string} channel
			 * @param  {string} message
			 * @return {Promise<undefined|Error|PermissionError>}
			 */
			WriteOnlyConnection.prototype[command] = function (config, emitter, channel, message) {
				return new Promise((resolve, reject) => {
					this.privmsg(channel, `.${command} ${message}`)

					const
						event = `NOTICE`,
						/** @type {(notice: import('./index.d.ts').Commands['NOTICE'])} */
						listener = notice => prop[notice['msg-id'].toString()]?.(notice, emitter, event, listener, resolve, reject),

						event2 = `USERNOTICE`,
						/** @type {(msg: import('./index.d.ts').Commands['USERNOTICE'])} */
						listener2 = msg => {
							if (msg.channel === channel && msg['msg-id'] === `announcement` && msg.login === config.nick)
								return resolve()
						}
					emitter.on(event, listener)

					const connectionHasChannel = emitter.rooms.get(channel) === this
					if (connectionHasChannel)
						emitter.on(event2, listener2)

					setTimeout(() => {
						emitter.removeListener(event, listener)
						emitter.removeListener(event2, listener2)

						return connectionHasChannel ? reject(Error(`${command} dropped`)) : resolve()
					}, config.promiseTimeout)
				})
			}
			continue
		case 8:
			/**
			 * Sends a CLEARCHAT.
			 * @param  {string} channel
			 * @return {Promise<undefined|Error|PermissionError>}
			 */
			WriteOnlyConnection.prototype[command] = function (config, emitter, channel) {
				return new Promise((resolve, reject) => {
					this.privmsg(channel, `.` + command)

					const
						event = `CLEARCHAT`,
						/** @type {(clear: import('./index.d.ts').Commands['CLEARCHAT'])} */
						listener = clear => {
							if (clear.channel === channel)
								return resolve()
						}

					if (emitter.rooms.get(channel) === this)
						return resolve()

					emitter.on(event, listener)

					setTimeout(() => {
						emitter.removeListener(event, listener)

						return reject(new TimeoutError(`${command} dropped`))
					}, config.promiseTimeout)
				})
			}
			continue
	}
	/**
	 * @param {string} channel
	 */
	WriteOnlyConnection.prototype[command] = function (config, emitter, channel) {
		this.privmsg(channel, `.` + command)

		return noticeCheck(command, prop, config, emitter, channel)
	}
}

ReadWriteConnection.prototype = {
	__proto__: null,
	...ReadOnlyConnection.prototype,
	...WriteOnlyConnection.prototype,
	readPermission: true,
	writePermission: true
}
