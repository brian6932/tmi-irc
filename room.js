// For some reason having this as an anonymous constructor
// within `Client` worsened `Client` creation time, so I opted to abstract it
// why doesn't js do inline instanciation optimization?
export const RoomTracker = class extends Map {
	/**
	 * @param  {string} key
	 * @param  {Connection} value
	 * @return {this}
	 */
	set(key, value) {
		const connection = super.get(key)
		if (connection !== undefined)
			this.writeSize -= connection.writePermission

		this.dedicatedSize += value.dedicated
		this.writeSize += value.writePermission

		return super.set(key, value)
	}
	/**
	 * @param  {string} key
	 * @return {boolean}
	 */
	delete(key) {
		const connection = super.get(key)
		if (connection === undefined)
			return false

		this.dedicatedSize -= connection.dedicated
		this.writeSize -= connection.writePermission

		return super.delete(key)
	}
}
RoomTracker.prototype.writeSize
	= RoomTracker.prototype.dedicatedSize
	= 0
