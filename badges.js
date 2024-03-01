// Currently there's only one badge which requires special handling
// once there are more, this will become an object used to make
// jump table switches within CommandParser
export const badges = new function () {
	Object.setPrototypeOf(this, null)

	this.predictions = true
}
