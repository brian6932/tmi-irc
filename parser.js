import { notice } from './notices.js'
import { tags } from './tags.js'
import { ircCommands } from './commands.js'
import { badges } from './badges.js'
import {
	space,
	semicolon,
	colon,
	equals,
	at,
	zero,
	nine,
	A,
	hashtag,
	bang,
	cr,
	lf,
	dash,
	backslash,
	s,
	r,
	comma,
	forwardslash,
	t
} from './characters.js'

// This wrapper method makes it so that you can request what CommandParser parses (most) key values into.
// $env:PARSE_INTO_BUFFERS=1 parses values into Buffers.
// Any other value (or lack thereof) for this environment variable will make CommandParser parse the Buffers into Strings (default behavior).
// The benefit being that Buffer subarrays are references, so there's no copy made until access.
// You can stringify Buffers with their toString() method and their (String) Symbol.toPrimitive.
// A few things to know:
// - (U)Int keys are still going to be parsed into (U)Ints.
// - JS Object keys will (and can only) still be Strings.
// - NOTICE msg-id, * command, * login, and * channel key values are exempt, as they're used internally, and are always Strings.
// - subarray's key value's exempt, as it's used internally, and is always a Buffer.

Buffer.prototype.parse = +process.env.PARSE_INTO_BUFFERS === 1
	? Buffer.prototype.subarray
	: function (start, end) {
		return this.toString(undefined, start, end)
	}

const
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

/**
 * Parses TMI (Twitch Messaging Interface).
 *
 * When multiple lines are sent in a single buffer (\r\n),
 * it sets the subarray property, and the client can choose
 * whether to continue parsing, or just parse once.
 * @type {import('./index.d.ts').CommandParser}
 */
export const CommandParser = function (buffer) {
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
									const number = zero <= buffer[i] && buffer[i] <= nine
									accumulator = accumulator << 4 | number * (buffer[i] - zero) + !number * ((buffer[i] & 0x4F) - A + 10)
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
								switch (notice[this[`msg-id`] = this[`msg-id`].toString()]) {
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
}
