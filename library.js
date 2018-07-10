'use strict';

var	async = require('async');
var winston = module.parent.require('winston');
var XRegExp = require('xregexp');
var validator = require('validator');
var nconf = module.parent.require('nconf');

var Topics = module.parent.require('./topics');
var Categories = module.parent.require('./categories');
var User = module.parent.require('./user');
var Groups = module.parent.require('./groups');
var Notifications = module.parent.require('./notifications');
var Privileges = module.parent.require('./privileges');
var Meta = module.parent.require('./meta');
var Utils = module.parent.require('../public/src/utils');
var batch = module.parent.require('./batch');

var SocketPlugins = module.parent.require('./socket.io/plugins');

var request = require.main.require('request');
var nconf = require.main.require('nconf');
var stream = require('getstream');
var config = require('./config');

var regex = XRegExp('(?:^|\\s)(@[\\p{L}\\d\\-_.]+)', 'g');	// used in post text transform, accounts for HTML
var rawRegex = XRegExp('(?:^|\\s)(@[\\p{L}\\d\-_.]+)', 'g');	// used in notifications, as raw text is passed in this hook
var isLatinMention = /@[\w\d\-_.]+$/;
var removePunctuationSuffix = function(string) {
	return string.replace(/[!?.]*$/, '');
};
var Entities = require('html-entities').XmlEntities;
var entities = new Entities();

var Mentions = {
	_settings: {},
	_defaults: {
		autofillGroups: 'off',
		disableGroupMentions: '[]',
		streamKey: '',
		streamSecret: ''
	}
};
SocketPlugins.mentions = {};

Mentions.init = function (data, callback) {
	var hostMiddleware = module.parent.require('./middleware');
	var controllers = require('./controllers');

	data.router.get('/admin/plugins/mentions-quest', hostMiddleware.admin.buildHeader, controllers.renderAdminPage);
	data.router.get('/api/admin/plugins/mentions-quest', controllers.renderAdminPage);

	// Retrieve settings
	Meta.settings.get('mentions-quest', function (err, settings) {
		Object.assign(Mentions._settings, Mentions._defaults, settings);
		callback();
	});
};

Mentions.addAdminNavigation = function (header, callback) {
	header.plugins.push({
		route: '/plugins/mentions-quest',
		name: 'Mentions Quest'
	});

	callback(null, header);
};

function getNoMentionGroups() {
	var noMentionGroups = ['registered-users', 'guests'];
	try {
		noMentionGroups = noMentionGroups.concat(JSON.parse(Mentions._settings.disableGroupMentions));
	} catch (err) {
		winston.error(err);
	}
	return noMentionGroups;
}

Mentions.notify = function(data) {
	var postData = data.post;
	var cleanedContent = Mentions.clean(postData.content, true, true, true);
	var matches = cleanedContent.match(rawRegex);

	if (!matches) {
		return;
	}

	var noMentionGroups = getNoMentionGroups();

	matches = matches.map(function(match) {
		return Utils.slugify(match);
	}).filter(function(match, index, array) {
		return match && array.indexOf(match) === index && noMentionGroups.indexOf(match) === -1;
	});

	if (!matches.length) {
		return;
	}

	async.parallel({
		userRecipients: function(next) {
			async.filter(matches, User.existsBySlug, next);
		},
		groupRecipients: function(next) {
			async.filter(matches, Groups.existsBySlug, next);
		}
	}, function(err, results) {
		if (err) {
			return;
		}

		console.log('>>> results', results);

		if (!results.userRecipients.length && !results.groupRecipients.length) {
			return;
		}

		async.parallel({
			topic: function(next) {
				Topics.getTopicFields(postData.tid, ['title', 'cid'], next);
			},
			author: function(next) {
				User.getUserField(postData.uid, 'fullname', next);
			},
			uids: function(next) {
				async.map(results.userRecipients, function(slug, next) {
					User.getUidByUserslug(slug, next);
				}, next);
			},
			groupData: function(next) {
				getGroupMemberUids(results.groupRecipients, next);
			},
			topicFollowers: function(next) {
				Topics.getFollowers(postData.tid, next);
			}
		}, function(err, results) {
			if (err) {
				return;
			}

			var title = entities.decode(results.topic.title);
			var titleEscaped = title.replace(/%/g, '&#37;').replace(/,/g, '&#44;');

			var uids = results.uids.filter(function(uid, index, array) {
				return array.indexOf(uid) === index && parseInt(uid, 10) !== parseInt(postData.uid, 10) && results.topicFollowers.indexOf(uid.toString()) === -1;
			});

			var groupMemberUids = {};
			results.groupData.groupNames.forEach(function(groupName, index) {
				results.groupData.groupMembers[index] = results.groupData.groupMembers[index].filter(function(uid) {
					if (!uid || groupMemberUids[uid]) {
						return false;
					}
					groupMemberUids[uid] = 1;
					return uids.indexOf(uid) === -1 &&
						parseInt(uid, 10) !== parseInt(postData.uid, 10) &&
						results.topicFollowers.indexOf(uid.toString()) === -1;
				});
			});

			sendNotificationToUids(postData, uids, 'user', '[[notifications:user_mentioned_you_in, ' + results.author + ', ' + titleEscaped + ']]');

			results.groupData.groupNames.forEach(function(groupName, index) {
				var memberUids = results.groupData.groupMembers[index];
				sendNotificationToUids(postData, memberUids, groupName, '[[notifications:user_mentioned_group_in, ' + results.author + ', ' + groupName + ', ' + titleEscaped + ']]');
			});
		});
	});
};

Mentions.addFilters = function (data, callback) {
	data.regularFilters.push({ name: '[[notifications:mentions]]', filter: 'mention' });
	callback(null, data);
};

Mentions.notificationTypes = function (data, callback) {
	data.types.push('notificationType_mention');
	callback(null, data);
};

function sendNotificationToUids(postData, uids, nidType, notificationText) {
	if (!uids.length) {
		return;
	}

	async.parallel({
		user: function(next) {
			User.getUserFields(postData.uid, ['username', 'fullname', 'apiId', 'userslug'], next);
		},
		topic: function(next) {
			Topics.getTopicFields(postData.tid, ['title', 'slug'], next);
		},
		category: function(next) {
			Categories.getCategoryFields(postData.cid, ['name', 'slug', 'bgColor'], next);
		},
		tags: function(next) {
			Topics.getTopicTagsObjects(postData.tid, next);
		}
	}, (err, results) => {
		if (err) {
			return;
		}

		var postInfo = results;
		var settings = Mentions._settings;
		var streamClient = stream.connect(settings.streamKey, settings.streamSecret);
		var env = config.environment;

		uids.forEach((uid) => {
			User.getUserFields(uid, ['username', 'fullname', 'apiId', 'userslug'], (err, userData) => {
				var userId = userData.apiId;
				var notificationFeed = streamClient.feed(env + '_notification', userId);
				var postLink = nconf.get('url') + '/topic/' + postInfo.topic.slug + '/' + postData.pid;
				var catLink = nconf.get('url') + '/category/' + postInfo.category.slug;
				var ownerLink = nconf.get('url') + '/user/' + postInfo.user.userslug;

				notificationFeed.addActivity({
					actor: postInfo.user.fullname,
					from: postInfo.user.apiId,
					verb: 'mentioned you in',
					object: postInfo.topic.title,
					target: 'forum notifications',
					foreign_id: env + '_forumpost_mention:' + postData.pid,
					owner: {
						fullname: postInfo.user.fullname,
						profileUrl: ownerLink
					},
					category: postInfo.category.name,
					catUrl: catLink,
					catColor: postInfo.category.bgColor,
					link: postLink,
					type: 'forum',
					timestamp: Math.round((new Date()).getTime() / 1000),
					post_data: {
						tags: postInfo.tags,
						post_type: 'forumpost',
						permalink: postLink
					}
				})
				.then((response) => {
					console.log('>>> response', response);
				})
				.catch((err) => {
					console.log('>>> err', err);
				})
			});
		});
	});
}

function createNotification(postData, nidType, notificationText, callback) {
	Notifications.create({
		type: 'mention',
		bodyShort: notificationText,
		bodyLong: postData.content,
		nid: 'tid:' + postData.tid + ':pid:' + postData.pid + ':uid:' + postData.uid + ':' + nidType,
		pid: postData.pid,
		tid: postData.tid,
		from: postData.uid,
		path: '/post/' + postData.pid,
		importance: 6
	}, callback);
}

function getGroupMemberUids(groupRecipients, callback) {
	async.map(groupRecipients, function(slug, next) {
		Groups.getGroupNameByGroupSlug(slug, next);
	}, function(err, groupNames) {
		if (err) {
			return callback(err);
		}
		async.map(groupNames, function(groupName, next) {
			Groups.getMembers(groupName, 0, -1, next);
		}, function(err, groupMembers) {
			if (err) {
				return callback(err);
			}
			callback(null, {groupNames: groupNames, groupMembers: groupMembers});
		});
	});
}

Mentions.parsePost = function(data, callback) {
	if (!data || !data.postData || !data.postData.content) {
		return callback(null, data);
	}

	Mentions.parseRaw(data.postData.content, function(err, content) {
		if (err) {
			return callback(err);
		}

		data.postData.content = content;
		callback(null, data);
	});
};

Mentions.parseRaw = function(content, callback) {
	var splitContent = Mentions.split(content, false, false, true);
	var matches = [];
	splitContent.forEach(function(cleanedContent, i) {
		if ((i & 1) === 0) {
			matches = matches.concat(cleanedContent.match(regex) || []);
		}
	});

	if (!matches.length) {
		return callback(null, content);
	}

	matches = matches.filter(function(cur, idx) {
		// Eliminate duplicates
		return idx === matches.indexOf(cur);
	}).map(function(match) {
		/**
		 *	Javascript-favour of regex does not support lookaround,
		 *	so need to clean up the cruft by discarding everthing
		 *	before the @
		 */
		var atIndex = match.indexOf('@');
		return atIndex !== 0 ? match.slice(atIndex) : match;
	});

	async.each(matches, function(match, next) {
		var slug = Utils.slugify(match.slice(1));
		match = removePunctuationSuffix(match);

		async.parallel({
			groupExists: async.apply(Groups.existsBySlug, slug),
			uid: async.apply(User.getUidByUserslug, slug),
			user: async.apply(User.getUsersWithFields, [slug], ['fullname'], 1)
		}, function(err, _results) {
			var results = _results;

			if (err) {
				return next(err);
			}

			if (results.user) {
				results.user = results.user[0];
			}
			
			if (results.uid || results.groupExists) {
				var regex = isLatinMention.test(match)
					? new RegExp('(?:^|\\s)' + match + '\\b', 'g')
					: new RegExp('(?:^|\\s)' + match, 'g');

				splitContent = splitContent.map(function(c, i) {
					if ((i & 1) === 1) {
						return c;
					}

					User.getUserFields(results.uid, ['fullname'], (err, userObj) => {
						return c.replace(regex, function(match) {
							// Again, cleaning up lookaround leftover bits
							var atIndex = match.indexOf('@');
							var plain = match.slice(0, atIndex);
							match = match.slice(atIndex);
							var str = results.user
									? '<a class="plugin-mentions-user plugin-mentions-a" href="' + nconf.get('url') + '/uid/' + results.uid + '">@' + userObj.fullname + '</a>'
									: '<a class="plugin-mentions-group plugin-mentions-a" href="' + nconf.get('url') + '/groups/' + slug + '">' + match + '</a>';
	
							return plain + str;
						});
					})
				});
			}

			next();
		});
	}, function(err) {
		callback(err, splitContent.join(''));
	});
};

Mentions.clean = function(input, isMarkdown, stripBlockquote, stripCode) {
	var split = Mentions.split(input, isMarkdown, stripBlockquote, stripCode);
	split = split.filter(function(e, i) {
		// only keep non-code/non-blockquote
		return (i & 1) === 0;
	});
	return split.join('');
};

Mentions.split = function(input, isMarkdown, splitBlockquote, splitCode) {
	if (!input) {
		return [];
	}

	var matchers = [isMarkdown ? '\\[.*?\\]\\(.*?\\)' : '<a[\\s\\S]*?</a>|<[^>]+>'];
	if (splitBlockquote) {
		matchers.push(isMarkdown ? '^>.*$' : '^<blockquote>.*?</blockquote>');
	}
	if (splitCode) {
		matchers.push(isMarkdown ? '`[^`\n]+`' : '<code[\\s\\S]*?</code>');
	}
	return input.split(new RegExp('(' + matchers.join('|') + ')', 'gm'));
};

/*
	WebSocket methods
*/

SocketPlugins.mentions.listGroups = function(socket, data, callback) {
	if (Mentions._settings.autofillGroups === 'off') {
		return callback(null, []);
	}

	Groups.getGroups('groups:visible:createtime', 0, -1, function(err, groups) {
		if (err) {
			return callback(err);
		}
		var noMentionGroups = getNoMentionGroups();
		groups = groups.filter(function(groupName) {
			return groupName && !noMentionGroups.includes(groupName);
		}).map(function(groupName) {
			return validator.escape(groupName);
		});
		callback(null, groups);
	});
};

module.exports = Mentions;
