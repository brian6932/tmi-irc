import { PermissionError, UsageError, UnrecognizedError } from './errors.js'

const
	pass = (notice, emitter, event, listener, resolve, reject, delay = 0) => {
		emitter.removeListener(event, listener)
		return setTimeout(resolve, delay)
	},
	fail = (notice, emitter, event, listener, resolve, reject) => {
		emitter.removeListener(event, listener)
		return reject(Error(notice.message.toString()))
	},
	permissions = (notice, emitter, event, listener, resolve, reject) => {
		emitter.removeListener(event, listener)
		return reject(new PermissionError(notice.message.toString()))
	},
	usage = (notice, emitter, event, listener, resolve, reject) => {
		emitter.removeListener(event, listener)
		return reject(new UsageError(notice.message.toString()))
	},
	unrecognized = (notice, emitter, event, listener, resolve, reject) => {
		emitter.removeListener(event, listener)
		return reject(new UnrecognizedError(notice.message.toString()))
	},
	modsvips = (notice, emitter, event, listener, resolve) => {
		emitter.removeListener(event, listener)
		return resolve(notice.users)
	}

export const
	notice = {
		__proto__: null,

		room_mods: 0,
		vips_success: 1,
		no_mods: 2,
		no_vips: 3
	},
	privmsgCommands = new function () {
		Object.setPrototypeOf(this, null)

		this.followers = new function () {
			this.followers_on_zero
				= this.already_followers_on
				= pass

			this.no_permission = permissions
		}
		this.followersoff = new function () {
			this.followers_off
				= this.already_followers_off
				= pass

			this.no_permission = permissions
		}

		this.slow = new function () {
			this.slow_on
				= this.already_slow_on
				= pass

			this.no_permission = permissions

			this.jump = 5
		}
		this.slowoff = new function () {
			this.slow_off
				= this.already_slow_off
				= pass

			this.no_permission = permissions

			this.jump = 5
		}

		this.subscribers = new function () {
			this.subs_on
				= this.already_subs_on
				= pass

			this.no_permission = permissions

			this.jump = 5
		}
		this.subscribersoff = new function () {
			this.subs_off
				= this.already_subs_off
				= pass

			this.no_permission = permissions

			this.jump = 5
		}

		this.uniquechat = new function () {
			this.r9k_on
				= this.already_r9k_on
				= pass

			this.no_permission = permissions

			this.jump = 5
		}
		this.uniquechatoff = new function () {
			this.r9k_off
				= this.already_r9k_off
				= pass

			this.no_permission = permissions

			this.jump = 5
		}

		this.emoteonly = new function () {
			this.emote_only_on
				= this.already_emote_only_on
				= pass

			this.no_permission = permissions

			this.jump = 5
		}
		this.emoteonlyoff = new function () {
			this.emote_only_off
				= this.already_emote_only_off
				= pass

			this.no_permission = permissions

			this.jump = 5
		}

		this.delete = {
			delete_message_success: pass,

			delete_chat_message_not_found: fail,

			usage_delete: usage,

			no_permission: permissions,

			jump: 1
		}

		this.ban = new function () {
			this.already_banned
				= this.ban_success
				= pass

			this.bad_ban_broadcaster
				= this.bad_ban_mod
				= this.bad_ban_self
				= this.bad_ban_staff
				= this.bad_unban_no_ban
				= this.bad_ban_admin
				= this.bad_ban_anon
				= fail

			this.usage_ban = usage

			this.no_permission = permissions

			this.jump = 3
		}
		this.unban = new function () {
			this.unban_success
				= this.bad_unban_no_ban
				= pass

			this.usage_unban = usage

			this.no_permission = permissions

			this.jump = 1
		}

		this.timeout = new function () {
			this.timeout_success = pass

			this.bad_timeout_anon
				= this.bad_timeout_mod
				= this.bad_timeout_staff
				= this.bad_timeout_broadcaster
				= this.bad_timeout_self
				= this.bad_timeout_admin
				= this.bad_timeout_duration
				= fail

			this.usage_timeout = usage

			this.no_permission = permissions

			this.jump = 2
		}
		this.untimeout = new function () {
			this.untimeout_success
				= this.timeout_no_timeout
				= pass

			this.usage_untimeout = usage

			this.no_permission = permissions

			this.jump = 1
		}

		this.color = {
			color_changed: pass,

			turbo_only_color: fail,

			usage_color: usage,

			jump: 0
		}

		this.mod = new function () {
			this.mod_success
				= this.bad_mod_mod
				= pass

			this.bad_mod_banned = fail

			this.mod_usage = usage

			this.no_permission = permissions

			this.jump = 1
		}
		this.unmod = new function () {
			this.unmod_success
				= this.bad_unmod_mod
				= pass

			this.unmod_usage = usage

			this.no_permission = permissions

			this.jump = 1
		}

		this.vip = new function () {
			this.vip_success
				= this.bad_vip_grantee_already_vip
				= pass

			this.bad_vip_grantee_banned
				= this.bad_vip_max_vips_reached
				= fail

			this.vip_usage = usage

			this.no_permission = permissions

			this.jump = 1
		}
		this.unvip = new function () {
			this.unvip_success
				= this.bad_unvip_grantee_not_vip
				= pass

			this.unvip_usage = usage

			this.no_permission = permissions

			this.jump = 1
		}

		this.mods = new function () {
			this.room_mods
				= this.no_mods
				= modsvips
		}
		this.vips = new function () {
			this.vips_success
				= this.no_vips
				= modsvips
		}

		this.raid = new function () {
			this.raid_error_already_raiding
				= this.raid_notice_mature
				= this.raid_notice_restricted_chat
				= pass

			this.raid_error_self
				= this.raid_error_forbidden
				= fail

			this.usage_raid = usage

			this.jump = 4
		}

		this.unraid = new function () {
			this.unraid_success
				= this.unraid_error_no_active_raid
				= pass

			this.unraid_error_unexpected = fail

			this.jump = 5
		}

		this.w = new function () {
			this.whisper_restricted
				= this.whisper_banned_recipient
				= this.whisper_limit_per_min
				= this.whisper_limit_per_sec
				= this.whisper_restricted_recipient
				= this.whisper_invalid_login
				= this.usage_whisper
				= this.whisper_banned
				= this.whisper_invalid_args
				= this.whisper_invalid_self
				= fail

			this.jump = 6
		}

		this.announce = {
			usage_announce: fail,

			no_permission: permissions,

			jump: 7
		}

		this.clear = {
			// usage_clear: fail you can't really encounter this

			no_permission: permissions,

			jump: 8
		}

		for (const command in this) {
			Object.setPrototypeOf(this[command], null)
			this[command].unrecognized_cmd = unrecognized
			// For some reason color requires a 1 second delay
			this[command].delay = (command === `color`) * 1_000
		}
	}
