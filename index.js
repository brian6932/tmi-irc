import { TLSSocket } from 'node:tls'
import { EventEmitter } from 'tseep'
import { tags } from './tags.js'
import { ircCommands } from './commands.js'
import { badges } from './badges.js'
import { notice, privmsgCommands } from './notices.js'
import { PermissionError, TimeoutError } from './errors.js'
import { RoomTracker } from './room.js'
import { Config } from './config.js'
import { inspect } from 'node:util'
inspect.defaultOptions.depth = undefined
inspect.defaultOptions.maxArrayLength = Infinity

console.warn(process.pid)

// This wrapper method makes it so that you can request what CommandParser parses (most) key values into.
// $env:PARSE_INTO_BUFFERS=1 parses values into Buffers.
// Any other value (or lack thereof) for this environment variable will make CommandParser parse the Buffers into Strings (default behavior).
// The benefit being that Buffer subarrays are references, so there's no copy made until access.
// You can stringify Buffers with their toString() method and their (String) Symbol.toPrimitive.
// A few things to know:
// - (U)Int keys are still going to be parsed into (U)Ints.
// - JS Object keys will (and can only) still be Strings.
// - command, login, and channel key values are exempt, as they're used internally, and are always Strings.
// - subarray's key value's exempt, as it's used internally, and is always a Buffer.

Buffer.prototype.parse = +process.env.PARSE_INTO_BUFFERS === 1
	? Buffer.prototype.subarray
	: function (start, end) {
		return this.toString(undefined, start, end)
	}

const
	space = ` `.charCodeAt(),
	semicolon = `;`.charCodeAt(),
	colon = `:`.charCodeAt(),
	equals = `=`.charCodeAt(),
	at = `@`.charCodeAt(),
	zero = `0`.charCodeAt(),
	nine = `9`.charCodeAt(),
	A = `A`.charCodeAt(),
	hashtag = `#`.charCodeAt(),
	bang = `!`.charCodeAt(),
	cr = `\r`.charCodeAt(),
	lf = `\n`.charCodeAt(),
	dash = `-`.charCodeAt(),
	backslash = `\\`.charCodeAt(),
	s = `s`.charCodeAt(),
	r = `r`.charCodeAt(),
	comma = `,`.charCodeAt(),
	forwardslash = `/`.charCodeAt(),
	t = `t`.charCodeAt(),

	// `@.tmi.twitch.tv `.length === 16
	IRCPrefixHostLength = 16,

	/** @type {(subarray: Buffer) => Buffer|string} */
	unescape = subarray => {
		// I did make a more optimized version of this,
		// but it was so buggy that I had to scrap it,
		// hopefully I can fix it sometime and add it back
		const copyarray = Buffer.allocUnsafe(subarray.length)
		let copyOffset = 0

		for (let i = 0;i < subarray.length;++i) {
			// backslash is the escape character
			if (subarray[i] !== backslash) {
				copyOffset = copyarray.writeUint8(subarray[i], copyOffset)
				continue
			}
			switch (subarray[i + 1]) {
				case s:
					copyOffset = copyarray.writeUint8(space, copyOffset)
					++i
					continue
				case backslash:
					copyOffset = copyarray.writeUint8(backslash, copyOffset)
					++i
					continue
				case colon:
					copyOffset = copyarray.writeUint8(semicolon, copyOffset)
					++i
					continue
				case r:
					copyOffset = copyarray.writeUint8(cr, copyOffset)
					++i
					continue
			}
		}

		return copyarray.parse(undefined, copyOffset)
	}

export const
	/**
	 * Parses TMI (Twitch Messaging Interface).
	 *
	 * When multiple lines are sent in a single buffer (\r\n),
	 * it sets the subarray property, and the client can choose
	 * whether to continue parsing, or just parse once.
	 * @type {import('./index.d.ts').CommandParser}
	 */
	CommandParser = function (buffer) {
		Object.setPrototypeOf(this, null)
		switch (buffer[0]) {
			case at: {
				let
					offset = 1,
					i = 0,
					key = ``

				tags:
				while (i < buffer.length) {
					switch (buffer[++i]) {
						case cr:
							++i
						case lf:
							// Sometimes Twitch sends multiple commands in the same buffer.
							// It is up to the client to continue parsing attatched subarrays.
							if (buffer.length !== ++i)
								this.subarray = buffer.subarray(i)

							return
						case equals: {
							key = buffer.toString(undefined, offset, i)
							offset = i + 1

							// jump table switch
							// https://github.com/v8/v8/blob/0c9f9732d333d3f73d4eb01c80fc6a2904ed3cce/src/interpreter/bytecode-generator.cc#L2148-L2212
							switch (tags[key]) {
								// Converts u8 buffers directly into uints
								case 0: {
									const negative = buffer[i + 1] === dash
									i += negative

									let accumulator = 0
									intifier:
									for (;;) {
										switch (buffer[++i]) {
											case space:
												// space cases require a decrement to be re-entered into the tags loop
												// else it will infinite loop
												--i
												break intifier
											case semicolon:
												offset = ++i
												break intifier
										}
										accumulator = (accumulator << 3) + (accumulator << 1) + buffer[i] - zero
									}

									// branchless conditional number flipper
									// won't work on > int32 negative ints
									// there are (currently) no tags that would exhibit that edge case
									this[key] = ((~negative + 1) * accumulator << 1) + accumulator

									break
								}
								// These uints are too large for int32, which's what JS converts to when using bitwise operators
								case 1: {
									let accumulator = 0
									uintifier:
									for (;;) {
										switch (buffer[++i]) {
											case space:
												--i
												break uintifier
											case semicolon:
												offset = ++i
												break uintifier
										}
										accumulator = accumulator * 10 + buffer[i] - zero
									}

									this[key] = accumulator

									break
								}
								case 2: {
									if (i === (i += buffer[++i] === hashtag)) {
										this[key] = null
										offset = i += 2
										break
									}

									let accumulator = 0
									colorizer:
									for (;;) {
										switch (buffer[++i]) {
											case space:
												--i
												break colorizer
											case semicolon:
												offset = ++i
												break colorizer
										}
										accumulator = accumulator << 4 | (
											zero <= buffer[i] && buffer[i] <= nine
												? buffer[i] - zero
												: (buffer[i] & 0x4F) - A + 10
										)
									}

									this[key] = accumulator

									break
								}
								case 3:
									this[key] = buffer[++i] === t
									for (;;)
										switch (buffer[++i]) {
											case space:
												--i
												continue tags
											case semicolon:
												offset = ++i
												continue tags
										}
								case 4: {
									// There's always at least 1 emote-set (global emote-set 0)
									this[key] = Array(1)
									let set = -1
									for (;;)
										switch (buffer[++i]) {
											case comma:
												this[key][++set] = buffer.parse(offset, i)
												offset = ++i
												break
											case space:
												--i
												continue tags
											case semicolon:
												offset = ++i
												continue tags
										}
								}
								case 5:
									this[key] = new function () {
										Object.setPrototypeOf(this, null)

										for (;;)
											switch (buffer[++i]) {
												case space:
													--i
													return
												case semicolon:
													offset = ++i
													return
												case forwardslash: {
													const key = buffer.toString(undefined, offset, i)
													if (badges[key] !== undefined) {
														let endOfTag = false
														this[key] = new function () {
															Object.setPrototypeOf(this, null)

															offset = ++i
															while (buffer[++i] !== dash);
															const key = buffer.toString(undefined, offset, i)

															let accumulator = 0
															badge:
															for (;;) {
																switch (buffer[++i]) {
																	case space:
																		this[key] = accumulator
																		--i
																		endOfTag = true
																		return
																	case semicolon:
																		this[key] = accumulator
																		offset = ++i
																		endOfTag = true
																		return
																	case comma:
																		this[key] = accumulator
																		offset = i + 1
																		break badge
																}
																accumulator = (accumulator << 3) + (accumulator << 1) + buffer[i] - zero
															}
														}

														if (endOfTag)
															return

														continue
													}

													let accumulator = 0
													badge:
													for (;;) {
														switch (buffer[++i]) {
															case space:
																this[key] = accumulator
																--i
																return
															case semicolon:
																this[key] = accumulator
																offset = ++i
																return
															case comma:
																this[key] = accumulator
																offset = i + 1
																break badge
														}
														accumulator = (accumulator << 3) + (accumulator << 1) + buffer[i] - zero
													}
												}
											}
									}
									break
								case 6:
									this[key] = new function () {
										Object.setPrototypeOf(this, null)

										for (;;)
											switch (buffer[++i]) {
												case space:
													--i
													return
												case semicolon:
													offset = ++i
													return
												case forwardslash: {
													let endOfTag = false
													const key = buffer.toString(undefined, offset, i)
													if (badges[key] !== undefined) {
														this[key] = new function () {
															Object.setPrototypeOf(this, null)

															const
																key = buffer.toString(undefined, offset, i),
																start = ++i
															let end

															badge:
															for (;;)
																switch (buffer[++i]) {
																	case comma:
																		end = i
																		offset = ++i
																		break badge
																	case space:
																		end = i--
																		endOfTag = true
																		break badge
																	case semicolon:
																		end = i
																		offset = ++i
																		endOfTag = true
																		break badge
																}

															this[key] = unescape(buffer.subarray(start, end))
														}

														if (endOfTag)
															return

														continue
													}

													let accumulator = 0
													badge:
													for (;;) {
														switch (buffer[++i]) {
															case space:
																this[key] = accumulator
																--i
																return
															case semicolon:
																this[key] = accumulator
																offset = ++i
																return
															case comma:
																this[key] = accumulator
																offset = i + 1
																break badge
														}
														accumulator = (accumulator << 3) + (accumulator << 1) + buffer[i] - zero
													}
												}
											}
									}
									break
								case 7: {
									const start = offset
									let end

									endOfTag:
									for (;;)
										switch (buffer[++i]) {
											case space:
												end = i--
												break endOfTag
											case semicolon:
												end = i
												offset = ++i
												break endOfTag
										}

									this[key] = unescape(buffer.subarray(start, end))

									break
								}
								default:
									for (;;)
										switch (buffer[++i]) {
											case space:
												this[key] = buffer.parse(offset, i--)
												continue tags
											case semicolon:
												this[key] = buffer.parse(offset, i)
												offset = ++i
												continue tags
										}
							}

							continue
						}
						case space: {
							// Hacky way to check for a WHISPER early
							const whisper = this[`thread-id`] !== undefined
							// Hacky way to check for a PRIVMSG early
							if (this[`first-msg`] !== undefined || whisper) {
								offset = i += 2
								while (buffer[++i] !== bang);
								this.login = buffer.parse(offset, i)
								offset = i += (this.login.length << 1) + IRCPrefixHostLength + 1
							}
							else
								offset = i += IRCPrefixHostLength

							command:
							for (;;)
								switch (buffer[++i]) {
									case cr:
										this.command = buffer.toString(undefined, offset, i)
										continue tags
									case space:
										break command
								}
							this.command = buffer.toString(undefined, offset, i)

							offset = i += 2

							colon:
							for (;;)
								switch (buffer[++i]) {
									case cr:
										this.channel = buffer.toString(undefined, offset, i)
										continue tags
									case colon:
										break colon
								}

							this.channel = buffer.toString(undefined, offset - whisper, --i)

							commands:
							switch (ircCommands[this.command]) {
								case 0: {
									// vips has a period
									let vips = 1
									switch (notice[this[`msg-id`].toString()]) {
										case 0:
											// `moderators`.length - `VIPs`.length === 6
											i += 6
											vips = 0
										case 1: {
											// `: The VIPs of this channel are: `.length === 32
											offset = i += 32


											// max username length = 25 + (`, `.length === 2) = 27
											// this will under allocate a bit, as it accounts for best case
											// it's not really feasible to account for the worst case
											this.users = Array(Math.ceil((buffer.length - offset - 2) / 27))
											let user = -1
											for (;;)
												switch (buffer[i += 2]) {
													case comma:
														++i
													case space:
														this.users[++user] = buffer.parse(offset, i - 1)
														offset = i + 1
														break
													case cr:
														++i
													case lf:
														this.users[++user] = buffer.parse(offset, i - 1 - vips)
														return
												}
										}
										case 2:
										case 3:
											this.users = []
											break commands
									}
								}
								case 10:
									// ` :`.length === 2
									this.action = buffer[offset = i += 2] === 1

									// Minimum length of an unparsed message body must be 3 chars (\r\n + a single char).
									// With tags, each full PRIVMSG command is at minimum 250 chars.
									// Twitch likes to combine smaller PRIVMSGs from different chatters if they were sent within 10ms.
									// This is required to deal with multi-buffer messages in an efficient manner.
									if ((buffer.length - 3) - (i + 3 + this.action * 9) > 250)
										for (;;)
											switch (buffer[i += 2]) {
												case cr:
													++i
												case lf:
													this.message = buffer.parse(offset + this.action * 8, i - 1 - this.action)
													if (buffer.length > ++i)
														this.subarray = buffer.subarray(i, buffer.length)

													return
											}

									// `\u{1}ACTION `.length === 8
									// `\r\n`.length === 2
									this.message = buffer.parse(offset + this.action * 8, buffer.length - 2 - this.action)
									return
							}

							this.message = buffer.parse(offset + this.channel.length + 2 - whisper, buffer.length - 2)
							return
						}
					}
				}
				return
			}
			case colon: {
				let i = 1
				while (buffer[++i] !== space);
				let offset = ++i

				command:
				for (;;)
					switch (buffer[++i]) {
						case space:
							break command
						case cr:
							// The only command where this occurs currently's RECONNECT,
							// so there's not real reason to continue the loop after
							this.command = buffer.toString(undefined, offset, i)
							return
					}

				// jump table switch
				// https://github.com/v8/v8/blob/0c9f9732d333d3f73d4eb01c80fc6a2904ed3cce/src/interpreter/bytecode-generator.cc#L2148-L2212
				commands:
				switch (ircCommands[this.command = buffer.toString(undefined, offset, i)]) {
					case 0:
						// ` * :`.length === 4
						this.message = buffer.parse(i + 4, buffer.length - 2)

						return
					// Apparently Twitch doesn't send you unique pings
					case 1:
						this.message = buffer.parse(i + IRCPrefixHostLength, buffer.length - 2)

						return
					case 2: {
						offset = ++i
						while (buffer[++i] !== space);
						this.login = buffer.toString(undefined, offset, i)

						offset = i += 4
						while (buffer[++i] !== space);
						this.channel = buffer.toString(undefined, offset, i)

						// ` :`.length === 2
						offset = i += 2
						// this is enabled by requesting membership
						// if not enabled, your login will be the only member
						this.members = Array(1)
						let member = -1
						for (;;)
							switch (buffer[++i]) {
								case space:
									this.members[++member] = buffer.parse(offset, i)
									offset = ++i
									continue
								case cr:
									this.members[++member] = buffer.parse(offset, i)
									offset = i + 1
									break commands
							}
					}
					case 3:
						offset = ++i
						while (buffer[++i] !== space);
						this.login = buffer.toString(undefined, offset, i)

						offset = i += 2
						while (buffer[++i] !== space);
						this.channel = buffer.toString(undefined, offset, i)

						// `End of /NAMES list`.length === 18
						this.message = buffer.parse(i += 2, i += 18)

						break
					case 4:
						this.message = buffer.parse(i + 2, buffer.length - 2)

						return
					case 5:
						offset = ++i
						while (buffer[++i] !== space);
						this.login = buffer.toString(undefined, offset, i)

						offset = i += 2

						for (;;)
							switch (buffer[i += 2]) {
								case cr:
									++i
								case lf:
									this.message = buffer.parse(offset, i - 1)
									break commands
							}
					case 6: {
						const loginEnd = i - (this.command.length + IRCPrefixHostLength)
						let loginStart = loginEnd - 1
						while (buffer[--loginStart] !== at);
						this.login = buffer.toString(undefined, loginStart + 1, loginEnd + 1)

						// ` #`.length === 2
						offset = i += 2

						for (;;)
							switch (buffer[i += 2]) {
								case cr:
									++i
								case lf:
									this.channel = buffer.toString(undefined, offset, i - 1)
									break commands
							}
					}
					case 7: {
						offset = i - this.command.length
						// `* `.length === 2
						i += 2
						while (buffer[++i] !== space);
						this.command = buffer.toString(undefined, offset, i)
						offset = i += 2

						// Known capabilities: 'twitch.tv/tags', 'twitch.tv/commands', 'twitch.tv/membership'
						// I explicitely don't use the keys() iterator method here
						// in the case that any membership capabilities are added
						// and additionally to avoid a null coalescing branch
						this.capabilities = Array(3)
						let capability = -1
						for (;;)
							switch (buffer[++i]) {
								case space:
									this.capabilities[++capability] = buffer.parse(offset, i)
									offset = ++i
									continue
								case cr:
									this.capabilities[++capability] = buffer.parse(offset, i)
									offset = i + 1

									this.capabilities.length = capability + 1
									return
							}
					}
					case 8: {
						// ` #`.length === 2
						offset = i += 2
						while (buffer[++i] !== space);
						this.channel = buffer.toString(undefined, offset, i)

						// ` :`.length === 2
						offset = i += 2
						while (buffer[++i] !== space);
						this.hosting = buffer.parse(offset, i)

						let accumulator = 0

						while (buffer[++i] !== cr)
							accumulator = (accumulator << 3) + (accumulator << 1) + buffer[i] - zero
						this.viewers = accumulator

						return
					}
					case 9: {
						offset = ++i

						while (buffer[++i] !== space);
						this.login = buffer.toString(undefined, offset, i)

						offset = ++i
						while (buffer[++i] !== space);
						this.failed = buffer.parse(offset, i)

						// ` :`.length === 2
						offset = i += 2
						for (;;)
							switch (buffer[i += 2]) {
								case cr:
									++i
								case lf:
									this.message = buffer.parse(offset, i - 1)
									break commands
							}
					}
				}
				// Checks if the buffer's longer than one line
				switch (buffer[i]) {
					case cr:
						++i
					case lf:
						if (buffer.length !== ++i)
							this.subarray = buffer.subarray(i)

						return
				}

				break
			}
			default: {
				let i = 0
				while (buffer[++i] !== space);
				this.command = buffer.toString(undefined, undefined, i)
			}
		}
	},


	/**
	 * @constructor
	 * @type {import('./index.d.ts').Client}
	 */
	Client = (config = new Config) => {
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
				const message = notice.message.toString()
				if (message === `Login authentication failed`)
					throw Error(message)
			})
		}
		initBufferOffset += initBuffer.write(nick, initBufferOffset)

		initBuffer = initBuffer.subarray(undefined, initBufferOffset)

		const
			Connection = function () {
				const collect = Buffer.allocUnsafe(30_000)
				/** @type {TLSSocket} */
				this.socket = new TLSSocket
				this.ready = new Promise(resolve => this.socket.once(`data`, () => resolve()))
				let pingterval

				this.socket
					.setNoDelay()
					.on(`PING`, () => this.socket.write(`pong\n`))
					.once(`connect`, () => pingterval = setInterval(() => this.ping(), 300_000))
					.once(`close`, () => clearInterval(pingterval))
					.connect(6697, `irc.chat.twitch.tv`)
					.on(`data`, tmi => {
						if (tmi[tmi.length - 1] !== lf)
							return this.offset += tmi.copy(collect, this.offset)
						else if (this.offset !== 0) {
							tmi = collect.subarray(undefined, this.offset + tmi.copy(collect, this.offset))
							this.offset = 0
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
			ReadOnlyConnection = function () {
				Connection.call(this)
			},
			WriteOnlyConnection = function () {
				Connection.call(this)
			},
			ReadWriteConnection = function () {
				Connection.call(this)
			}

		Connection.prototype = {
			__proto__: null,
			offset: 0,
			ping: function () {
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

					this.socket.write(`ping ${ts}\n`)
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
			const
				prop = privmsgCommands[command],
				noticeCheck = (channel, connection) => {
					return new Promise((resolve, reject) => {
						const
							event = `NOTICE`,
							/** @type {(res: import('./index.d.ts').Commands['NOTICE'])} */
							listener = notice => {
								if (notice.channel === channel)
									return prop[notice['msg-id'].toString()]?.(notice, connection.socket, event, listener, resolve, reject, prop.delay)
							}
						emitter.on(event, listener)

						setTimeout(() => {
							emitter.removeListener(event, listener)

							return reject(new TimeoutError(command))
						}, config.promiseTimeout + prop.delay)
					})
				}

			// jump table switch
			// https://github.com/v8/v8/blob/0c9f9732d333d3f73d4eb01c80fc6a2904ed3cce/src/interpreter/bytecode-generator.cc#L2148-L2212
			switch (prop.jump) {
				case 0:
					/**
					 * @param {number|string} color
					 * @param {string}        [channel]
					 */
					WriteOnlyConnection.prototype[command] = (color, channel = config.nick) => {
						if (typeof color === `number`)
							color = `#` + (`0`.repeat(6 - (color = color.toString(16)).length) + color)

						socket.privmsg(channel, `.${command} ${color}`)

						return noticeCheck(channel, this)
					}
					continue
				case 1:
					// note to self, when making typings, give delete `msgID` as arg, and give the rest `login` as arg
					/**
					 * @param {string} channel
					 * @param {string} arg
					 */
					WriteOnlyConnection.prototype[command] = function (channel, arg) {
						this.privmsg(channel, `.${command} ${arg}`)

						return noticeCheck(channel, this)
					}
					continue
				case 2:
					/**
					 * @param {string}        channel
					 * @param {string}        login
					 * @param {string|number} [duration]
					 * @param {string}        [reason]
					 */
					WriteOnlyConnection.prototype[command] = function (channel, login, duration = ``, reason = ``) {
						this.privmsg(channel, `.${command} ${login}${duration && ` ` + duration}${reason && ` ` + reason}`)

						return noticeCheck(channel, this)
					}
					continue
				case 3:
					/**
					 * @param {string} channel
					 * @param {string} login
					 * @param {string} [reason]
					 */
					WriteOnlyConnection.prototype[command] = function (channel, login, reason = ``) {
						this.privmsg(channel, `.${command} ${login}${reason && ` ` + reason}`)

						return noticeCheck(channel, this)
					}
					continue
				case 4:
					/**
					 * @param {string} channel
					 * @param {string} login
					 */
					WriteOnlyConnection.prototype[command] = function (channel, login) {
						const raid = `.${command} ${login}`

						// To get any response back, we have to send twice
						// socket also makes it impossible to tell if you misraid
						this.socket.cork()
						this.privmsg(channel, raid)
						this.privmsg(channel, raid)
						this.socket.uncork()

						return noticeCheck(channel, this)
					}
					continue
				case 5:
					/**
					 * @param {string} channel
					 */
					WriteOnlyConnection.prototype[command] = function (channel) {
						const unraid = `.` + command

						// To get any response back, we have to send twice
						this.socket.cork()
						this.privmsg(channel, unraid)
						this.privmsg(channel, unraid)
						this.socket.uncork()

						return noticeCheck(channel, this)
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
					WriteOnlyConnection.prototype[command] = function (login, message, channel = config.nick) {
						return new Promise((resolve, reject) => {
							this.privmsg(channel, `.${command} ${login} ${message}`)

							const
								event = `NOTICE`,
								/** @type {(notice: import('./index.d.ts').Commands['NOTICE'])} */
								listener = notice => prop[notice['msg-id'].toString()]?.(notice, this.socket, event, listener, resolve, reject)
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
					WriteOnlyConnection.prototype[command] = function (channel, message) {
						return new Promise((resolve, reject) => {
							this.privmsg(channel, `.${command} ${message}`)

							const
								event = `NOTICE`,
								/** @type {(notice: import('./index.d.ts').Commands['NOTICE'])} */
								listener = notice => prop[notice['msg-id'].toString()]?.(notice, this.socket, event, listener, resolve, reject),

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
					 * Sends an CLEARCHAT.
					 * @param  {string} channel
					 * @return {Promise<undefined|Error|PermissionError>}
					 */
					WriteOnlyConnection.prototype[command] = function (channel) {
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
			WriteOnlyConnection.prototype[command] = function (channel) {
				this.privmsg(channel, `.` + command)

				return noticeCheck(channel, this)
			}
		}

		ReadWriteConnection.prototype = {
			__proto__: null,
			...ReadOnlyConnection.prototype,
			...WriteOnlyConnection.prototype,
			readPermission: true,
			writePermission: true
		}

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
						ready[i] = (this.read[i] = new ReadConnection).ready
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
						ready[itr.next().value] = (this.read[i] = new ReadOnlyConnection).ready
					for (const i of this.write.keys())
						ready[itr.next().value] = (this.write[i] = new WriteOnlyConnection).ready
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
							emitter.connections.write[i++] = new WriteOnlyConnection

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

					const parting = type === `part`

					if (parting) {
						for (const channel of channels) {
							const connection = emitter.rooms.get(channel)

							if (connection === undefined) {
								channels.delete(channel)
								continue
							}

							await connection.ready

							connection.socket.write(`${type} #${channel}\n`)
						}
					}
					else {
						let readSize = Math.ceil((channels.size + emitter.rooms.readSize) / config.readDivisor)

						while (readSize > emitter.connections.read.length)
							emitter.connections.read[emitter.connections.read.length] = new ReadConnection

						if (!config.mergeConnections) {
							let writeSize = Math.ceil((channels.size + emitter.rooms.writeSize) * config.writeMultiplier)
							while (writeSize > emitter.connections.write.length)
								emitter.connections.write[emitter.connections.write.length] = new WriteOnlyConnection
						}

						let channelsPerConnection = Math.ceil(channels.size / config.readDivisor)
						// clamps
						channelsPerConnection = (channelsPerConnection > config.readDivisor) * config.readDivisor + (channelsPerConnection < config.readDivisor) * channelsPerConnection
						const
							// The max length of a username can be's 25 bytes + (a leading `join #`.length === 6 bytes) + (a trailing `\n` === 1 byte) = 32 bytes
							// When joining multiple channels, we can comma seperate each, so 25 bytes + (a leading `,#`.length === 2 bytes) = 27 bytes
							buffer = Buffer.allocUnsafe((channels.size > 0) * 32 + (channelsPerConnection > 1) * (channelsPerConnection - 1) * 27),
							itr = channels.values(),
							// Channel/user names can only be ascii
							encoding = `ascii`
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
						return emitter.connections.write[++privmsgConnectionIndex % emitter.connections.write.length | 0][key](...arguments)
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
