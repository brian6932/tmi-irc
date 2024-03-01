export const ircCommands = new function () {
	Object.setPrototypeOf(this, null)

	this.NOTICE = 0

	this.PONG = 1

	this[`353`] = 2

	this[`366`] = 3

	this[`410`] = 4

	this[`001`]
		= this[`002`]
		= this[`003`]
		= this[`004`]
		= this[`375`]
		= this[`372`]
		= this[`376`]
		= 5

	this.PART
		= this.JOIN
		= 6

	this.CAP = 7

	this.HOSTTARGET = 8

	this[`421`] = 9

	this.PRIVMSG = 10

	this.PING = 11
}
