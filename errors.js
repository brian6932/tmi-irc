/** @type {ErrorConstructor} */
const TypedError = class extends Error {
	constructor(arg) {
		super(arg)
		this.name = this.constructor.name
	}
}

export const
	/** @type {ErrorConstructor} */
	TimeoutError = class extends TypedError {},
	/** @type {ErrorConstructor} */
	PermissionError = class extends TypedError {},
	/** @type {ErrorConstructor} */
	UsageError = class extends TypedError {},
	/** @type {ErrorConstructor} */
	UnrecognizedError = class extends TypedError {
		disclaimer = `PRIVMSG subcommands outside of .me require a first party token`
	}
