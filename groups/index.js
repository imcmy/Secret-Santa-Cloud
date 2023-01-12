'use strict';
const appid = ''
const secret = ''

const validateString = async (configurations, openid, content) => {
    let checkUrl = 'https://api.weixin.qq.com/wxa/msg_sec_check'
    let id = '63a8eed3e1a35c86f45ed885'

    let config = await configurations.doc(id).get({
        getOne: true
    })
    let res = await uniCloud.httpclient.request(checkUrl + '?access_token=' + config.data.access_token, {
        method: 'POST',
        data: JSON.stringify({
            version: 2,
            scene: 1,
            openid: openid,
            content: content
        })
    })
    res = JSON.parse(res.data.toString('ascii'))

    return res.result
}

const _ = uniCloud.database().command

exports.main = async (event, context) => {
    const JQL = uniCloud.databaseForJQL({
        event,
        context
    })
    const users = JQL.collection('users')
    const groups = JQL.collection('groups')
    const events = JQL.collection('events')
    const configurations = JQL.collection('configurations')

    let source = context.SOURCE
    let params
    if (source === 'http')
        params = event.queryStringParameters
    else if (source === 'function')
        params = event
    else
        return {
            errCode: 1,
            errMsg: "Context not supported"
        }

    let sessionId = params.session_id
    let action = params.action
    var where = {
        session_id: sessionId
    }

    var user = await users.where(where).get({
        getOne: true
    })
    var currTime = Date.now()
    if (!user.data || user.data.session_exp < currTime)
        return {
            errCode: 0x3,
            errMsg: "Session expired"
        }

    switch (action) {
        case 'create':
            var res = await validateString(configurations, user.data.wx_openid, params.name + params
                .description)
            if (res.suggest !== 'pass')
                return {
                    errCode: 0x24,
                    errMsg: "Validation not passed",
                    label: res.label
                }

            try {
                res = await groups.add({
                    group_name: params.name,
                    group_description: params.description,
                    group_icon: params.icon,
                    group_token: params.token,
                    group_manager: user.data._id,
                    group_members: [user.data._id],
                    audit_join: params.audit_join === "true",
                    waiting_members: [],
                    allow_member_create: params.allow_create === "true",
                    audit_create: params.audit_create === "true",
                    group_events: [],
                    waiting_events: []
                })
                user.data.groups.push(res.id)
                await users.doc(user.data._id).update({
                    groups: user.data.groups
                })
            } catch (e) {
                if (e.errCode === 'DUPLICATE_KEY')
                    return {
                        errCode: 0x23,
                        errMsg: "Group token duplicated"
                    }
                return e
            }

            return res
        case 'join':
            var group = await groups.where({
                group_token: params.token
            }).get({
                getOne: true,
                getCount: true
            })
            if (group.count === 0) {
                return {
                    errCode: 0x21,
                    errMsg: "No group matched"
                }
            } else if (user.data.groups.includes(group.data._id)) {
                return {
                    errCode: 0x22,
                    errMsg: "Already in the group"
                }
            } else if (group.data.waiting_members.includes(user.data._id)) {
                return {
                    errCode: 0x26,
                    errMsg: "Already in the waiting list"
                }
            }

            if (group.data.audit_join) {
                group.data.waiting_members.push(user.data._id)
                await groups.doc(group.data._id).update({
                    waiting_members: group.data.waiting_members
                })
                return {
                    errCode: 0x25,
                    errMsg: "Need audit"
                }
            }

            user.data.groups.push(group.data._id)
            var res = await users.doc(user.data._id).update({
                groups: user.data.groups
            })
            group.data.group_members.push(user.data._id)
            res = await groups.doc(group.data._id).update({
                group_members: group.data.group_members
            })
            return res
        case 'load_members':
            var group_members = await groups.where(
                    `_id == "${params.group_id}" && group_members == "${user.data._id}"`).field('group_members')
                .getTemp()
            var members = await JQL.collection(group_members, 'users').get()
            members.data = members.data[0].group_members.map(o => ['_id', 'nickname'].reduce((acc, curr) => {
                acc[curr] = o[curr];
                return acc;
            }, {}));
            return members
        case 'load_events':
            var group_events = await groups.where(
                    `_id == "${params.group_id}" && group_members == "${user.data._id}"`).field('group_events')
                .getTemp()
            var event = await JQL.collection(group_events, 'events').get()
            event.data = event.data[0].group_events.map(o => ['_id', 'event_name', 'event_description',
                'event_rolled', 'event_ended'
            ].reduce((acc, curr) => {
                acc[curr] = o[curr];
                return acc;
            }, {}));
            return event
        case 'load_waiting_events':
            var waiting_events = await groups.where(
                    `_id == "${params.group_id}" && group_manager == "${user.data._id}"`).field(
                    'waiting_events')
                .getTemp()
            var event = await JQL.collection(waiting_events, 'events').get()
            event.data = event.data[0].waiting_events.map(o => ['_id', 'event_name', 'event_description',
                'event_start'
            ].reduce((acc, curr) => {
                acc[curr] = o[curr];
                return acc;
            }, {}));
            return event
    }
};
