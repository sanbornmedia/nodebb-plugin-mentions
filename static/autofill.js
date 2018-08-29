"use strict";
/* globals socket, app, utils */


$(document).ready(function() {
	var groupList = [];
	var localUserList = [];

	$(window).on('composer:autocomplete:init', function(ev, data) {
		localUserList = loadDomUsers();

		if (!groupList.length) {
			loadGroupList();
		}

		var subset;
		var strategy = {
			match: /(^|\s)@(\w*(?:\s*\w*))$/,
			search: function (term, callback) {
				var userObjects;

				if (!term) {
					userObjects = localUserList.concat(groupList).filter(function(value, index, array) {
						var display_name = value.display_name;
						return array.map(function(value) {return value.display_name}).indexOf(value) === index
							   && display_name !== app.user.username;
					}).sort(function(first, second) {
						var a = first.display_name;
						var b = second.display_name;
						return a.toLocaleLowerCase() > b.toLocaleLowerCase();
					});
					return callback(userObjects);
				}

				socket.emit('plugins.quest.connections.searchUsers', {query: term}, function (err, userdata) {
					if (err) {
						return callback([]);
					}

					userObjects = userdata.users.map(function(user) {
						return {display_name: user.display_name, picture: user.avatar, nodebbuid: user.node_bb_id, apiId: user.id, username: user.username};
					});

					// Remove current user from suggestions
					if (app.user.fullname && userObjects.map(function(value) {return value.display_name}).indexOf(app.user.fullname) !== -1) {
						var index = userObjects.map(function(value) {return value.display_name}).indexOf(app.user.username);
						userObjects.splice(index, 1);
					}

					callback(userObjects);
				});
			},
			template: function (value, term) {
				var el = '<div class="qds-c-chatroom__search-result">' +
							'<div class="qds-c-avatar qds-c-avatar--size-xs" style="background-image:url(' + value.picture + '); background-size:100%;position:relative;"></div>' +
							'<span class="qds-c-messages__title qds-c-chatroom__search-result-name">' + value.display_name + '</span>' +
						'</div>';
				return el;
			},
			replace: function (mention) {
				mention = $('<div/>').html(mention.username).text();
				return ' @' + mention + ' ';
			},
			cache: true
		};

		data.strategies.push(strategy);
	});

	$(window).on('action:composer.loaded', function(e, data) {
		var composer = $('#cmp-uuid-' + data.post_uuid + ' .write');
		composer.attr('data-mentions', '1');
	});

	function loadDomUsers() {
		var ids = [];
		var DOMusers = [];
		$('[component="post"][data-uid!="0"]').each(function(idx, el) {
			var	apiId = el.getAttribute('data-api');
			if (ids.indexOf(apiId) === -1) {
				var display_name = el.getAttribute('data-username');
				var picture = el.getAttribute('data-picture');
				var nodebbuid = el.getAttribute('data-uid');

				var userObject = {
					display_name: display_name,
					picture: picture,
					nodebbuid: nodebbuid,
					apiId: apiId
				};
				DOMusers.push(userObject);
			}
		});
		return DOMusers;
	}

	function loadGroupList() {
		socket.emit('plugins.mentions.listGroups', function(err, groupNames) {
			if (err) {
				return app.alertError(err.message);
			}
			groupList = groupNames;
		});
	}

});
