export const Config = function () {}

Config.prototype = {
	__proto__: null,

	membershipCapability: false,
	commandsCapability: true,
	socket: `tcp`,
	pass: ``,
	channels: new Set,
	promiseTimeout: 2_000,
	/**
	 * By toggling this value to `false`, `readDivsior` won't be used for writes,
	 * and users can set the `writeMultiplier`.
	 * @type {Boolean}
	 */
	mergeConnections: true,
	/**
	 * This value only works when `mergeConnections` is `false`!
	 *
	 * `writeMultiplier >= 0`.
	 *
	 * `Math.ceil(channels.size || 1 * writeMultiplier)` = write connection count.
	 *
	 * ͏
	 *
	 *
	 * On `Client` creation, if `channels.size` is `0`, this number will be used without multiplying, AKA write-only mode.
	 *
	 * You can't join any channels in write-only mode.
	 * @type {Number}
	 */
	writeMultiplier: 1,
	/**
	 * When `mergeConnections` is `true`,
	 * this value will also control the write connection count.
	 *
	 * `readDivisor >= 1`.
	 *
	 * `Math.ceil(channels.size / readDivisor)` = read connection count.
	 *
	 * If `readDivisor < channels.size`, `readDivisor` = read connection count.
	 * @type {Number}
	 */
	readDivisor: 90
}
