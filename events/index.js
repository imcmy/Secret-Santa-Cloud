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
    var users = JQL.collection('users')
    var groups = JQL.collection('groups')
    var events = JQL.collection('events')
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
                    errCode: 0x31,
                    errMsg: "Validation not passed",
                    label: res.label
                }

            var transaction = await uniCloud.database().startTransaction()
            try {
                var _group = await groups.doc(params.group).field(
                    'group_manager,group_members,allow_member_create,audit_create,waiting_events,group_events'
                ).get({
                    getOne: true
                })
                if (!(_group.data.group_manager === user.data._id || (_group.data.allow_member_create && _group
                        .data
                        .group_members.includes(user.data._id))))
                    return {
                        errCode: 0x32,
                        errMsg: "Not allowed to create"
                    }

                groups = transaction.collection('groups')
                events = transaction.collection('events')
                res = await events.add({
                    event_name: params.name,
                    event_description: params.description,
                    event_group: params.group,
                    event_start: parseInt(params.start),
                    event_roll: parseInt(params.roll),
                    event_end: parseInt(params.end),
                    event_rolled: false,
                    event_ended: false,
                    event_audited: !_group.data.audit_create,
                    event_creator: user.data._id,
                    event_participates: [],
                    event_pairs: {}
                })

                if (_group.data.audit_create) {
                    await groups.doc(_group.data._id).update({
                        waiting_events: _.push(res.id)
                    })
                } else {
                    await groups.doc(_group.data._id).update({
                        group_events: _.push(res.id)
                    })
                }
            } catch (e) {
                await transaction.rollback()
                return e
            }

            await transaction.commit()
            return res
        case 'query':
            var event = await events.where({
                    _id: params.event_id
                }).field('event_name,event_description,event_start,event_roll,event_end,event_creator')
                .getTemp()
            event = await JQL.collection(event, 'users').get()
            event.data = event.data[0]
            event.data.event_creator = event.data.event_creator[0]['nickname']
            return event
        case 'audit':
            var transaction = await uniCloud.database().startTransaction()
            try {
                var _group = await groups.doc(params.group_id).field('waiting_events').get({
                    getOne: true
                })
                var index = _group.data.waiting_events.indexOf(params.event_id);
                if (index !== -1) {
                    _group.data.waiting_events.splice(index, 1);
                }

                events = transaction.collection('events')
                groups = transaction.collection('groups')
                await events.doc(params.event_id).update({
                    event_audited: params.result === 'pass'
                })
                if (params.result === 'pass') {
                    await groups.doc(params.group_id).update({
                        waiting_events: _group.data.waiting_events,
                        group_events: _.push(params.event_id)
                    })
                } else if (params.result === 'fail') {
                    await groups.doc(params.group_id).update({
                        waiting_events: _group.data.waiting_events
                    })
                }
            } catch (e) {
                await transaction.rollback()
                return e
            }

            await transaction.commit()
            return res
        case 'list':
            let eventRecords = {
                notStarted: [],
                underway: [],
                started: [],
                rolled: [],
                ended: []
            }
            let records = await events.where({
                event_audited: true,
                event_group: _.in(user.data.groups)
            }).field(
                'event_name,event_description,event_group,event_rolled,event_ended,event_start,event_roll,event_end,event_participates'
            ).getTemp()
            records = await JQL.collection(records, 'groups').get()
            records.data.forEach((item, index, _) => {
                item.event_group_name = item.event_group[0].group_name
                item.event_group = item.event_group[0]._id
                if (item.event_participates.includes(user.data._id)) {
                    item.joined = true
                    delete item.event_participates
                    if (item.event_start > currTime)
                        eventRecords.notStarted.push(item)
                    else if (!item.event_rolled)
                        eventRecords.started.push(item)
                    else if (!item.event_ended)
                        eventRecords.rolled.push(item)
                    else
                        eventRecords.ended.push(item)
                } else {
                    item.joined = false
                    delete item.event_participates
                    if (item.event_start > currTime)
                        eventRecords.notStarted.push(item)
                    else if (!item.event_rolled)
                        eventRecords.underway.push(item)
                }
            })
            return eventRecords
        case 'list_one':
            var event = await events.where({
                    _id: params.event_id,
                    event_audited: true
                }).field('event_creator,event_start,event_rolled,event_ended,event_participates,event_pairs')
                .getTemp()
            event = await JQL.collection(event, 'users').get()
            event.data = event.data[0]
            event.data.event_creator = event.data.event_creator[0].nickname
            if (event.data.event_start > currTime) {
                event.data.step = 0
                event.data.event_participates = event.data.event_participates.length
                delete event.data.event_pairs
            } else if (!event.data.event_rolled) {
                event.data.step = 1
                event.data.event_participates = event.data.event_participates.length
                delete event.data.event_pairs
            } else if (!event.data.event_ended) {
                event.data.step = 2
                event.data.event_participates = event.data.event_pairs.nicknames
                event.data.event_pairs = event.data.event_pairs.pairs[user.data._id]
                var wishlist = await users.doc(event.data.event_pairs.target).field('nickname,wishlist,addresses').get({
                    getOne: true
                })
                for (let i in wishlist.data.addresses) {
                    var addr = wishlist.data.addresses[i]
                    if (addr.current) {
                        wishlist.data.address = addr
                        break
                    }
                }
                wishlist.data.wishlist = wishlist.data.wishlist.slice(0, 3);
                delete wishlist.data.addresses
                event.data.event_pairs.target = wishlist.data
            } else {
                event.data.step = 3
                event.data.event_participates = event.data.event_pairs.results
                delete event.data.event_pairs
            }
            return event.data
        case 'join':
            var event = await events.where({
                _id: params.event_id,
                event_audited: true
            }).field('event_participates').get({
                getOne: true
            })
            event.data.event_participates.push(user.data._id)
            await events.where({
                _id: params.event_id,
                event_audited: true
            }).update({
                event_participates: event.data.event_participates
            })
            return event.data.event_participates.length
        case 'leave':
            var event = await events.where({
                _id: params.event_id,
                event_audited: true
            }).field('event_participates').get({
                getOne: true
            })
            var index = event.data.event_participates.indexOf(user.data._id);
            if (index !== -1) {
                event.data.event_participates.splice(index, 1);
            }
            await events.where({
                _id: params.event_id,
                event_audited: true
            }).update({
                event_participates: event.data.event_participates
            })
            return event.data.event_participates.length
    }
};
