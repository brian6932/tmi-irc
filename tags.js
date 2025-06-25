export const tags = new function () {
	Object.setPrototypeOf(this, null)

	this.bits
		= this.mod
		= this.r9k
		= this.rituals
		= this.slow
		= this.subscriber
		= this.turbo
		= this.vip
		= this[`ban-duration`]
		= this[`emote-only`]
		= this[`followers-only`] // int, can be negative
		= this[`message-id`]
		= this[`msg-param-multimonth-duration`]
		= this[`msg-param-multimonth-tenure`]
		= this[`msg-param-should-share-streak`]
		= this[`msg-param-sub-plan`]
		= this[`msg-param-cumulative-months`]
		= this[`msg-param-donation-amount`]
		= this[`msg-param-exponent`]
		= this[`msg-param-gift-months`]
		= this[`msg-param-mass-gift-count`]
		= this[`msg-param-months`]
		= this[`msg-param-recipient-id`]
		= this[`msg-param-streak-months`]
		= this[`msg-param-viewerCount`]
		= this[`msg-param-goal-current-contributions`]
		= this[`msg-param-goal-target-contributions`]
		= this[`msg-param-goal-user-contributions`]
		= this[`reply-parent-user-id`]
		= this[`reply-thread-parent-user-id`]
		= this[`returning-chatter`]
		= this[`room-id`]
		= this[`source-room-id`]
		= this[`subs-only`]
		= this[`target-user-id`]
		= this[`user-id`]
		= this[`first-msg`]
		= 0

	this[`sent-ts`]
		= this[`tmi-sent-ts`]
		= 1

	this.color = 2

	this[`msg-param-was-gifted`] = 3

	this[`emote-sets`] = 4

	this.badges
		= this[`source-badges`]
		= 5

	this[`badge-info`]
		= this[`source-badge-info`]
		= 6

	this[`client-nonce`]
		= this[`msg-param-sub-plan-name`]
		= this[`system-msg`]
		= this[`reply-parent-msg-body`]
		= this[`reply-parent-display-name`]
		// = this[`msg-param-origin-id`]
		= this[`msg-param-displayName`]
		= this[`display-name`]
		= 7
}
