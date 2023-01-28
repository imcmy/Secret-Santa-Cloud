'use strict';

const {
    stringify
} = require("querystring");

const _ = uniCloud.database().command
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
    var where = {}

    if (action === 'insert') {
        var res
        try {
            res = await uniCloud.callFunction({
                name: 'login',
                data: {
                    code: params.code,
                    platform: params.platform
                }
            })
            if (params.platform === 'qq') {
                where.qq_openid = res.result.qq_openid
                where.wx_openid = ''
            } else if (params.platform === 'wechat') {
                where.qq_openid = ''
                where.wx_openid = res.result.wx_openid
            }
        } catch (e) {
            return e
        }

        let userCheck = await users.where(where).count()
        if (userCheck.total > 0)
            return {
                errCode: 0x11,
                errMsg: "User already registered"
            }
        where.session_id = res.result.session_id
        where.session_exp = res.result.session_exp

        res = await validateString(configurations, where.wx_openid, params.nickname)
        if (res.suggest !== 'pass')
            return {
                errCode: 0x12,
                errMsg: "Validation not passed",
                label: res.label
            }

        var id
        Object.assign(where, {
            nickname: params.nickname,
            wishlist: [],
            groups: [],
            addresses: JSON.parse(params.addresses)
        });
        try {
            res = await users.add(where)
            id = res.id
            delete where['qq_openid']
            delete where['wx_openid']
        } catch (e) {
            return e
        }

        var data = {}
        data['session_id'] = where.session_id
        data['session_exp'] = where.session_exp
        delete where['session_id']
        delete where['session_exp']
        data['user'] = where

        return data
    }

    where.session_id = sessionId
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
        case 'update':
            var res = await validateString(configurations, user.data.wx_openid, params.nickname)
            if (res.suggest !== 'pass')
                return {
                    errCode: 0x12,
                    errMsg: "Validation not passed",
                    label: res.label
                }

            return users.where({
                _id: user.data._id
            }).update({
                nickname: params.nickname,
                addresses: JSON.parse(params.addresses)
            })
        case 'wish':
            return users.where({
                _id: user.data._id
            }).update({
                wishlist: JSON.parse(params.wishlist)
            })
        case 'load_groups':
            var res = {
                groups: [],
                group: {}
            }
            var _groups = await groups.where({
                _id: _.in(user.data.groups)
            }).get({
                getCount: true
            })
            if (_groups.count === 0)
                return res

            for (var g in _groups.data) {
                res.groups.push({
                    value: _groups.data[g]._id,
                    text: _groups.data[g].group_name,
                    icon: _groups.data[g].group_icon
                })
            }
            var manager = await users.doc(_groups.data[0].group_manager).field('nickname').get({
                getOne: true
            })
            var isManager = _groups.data[0].group_manager === user.data._id

            res.group = _groups.data[0]
            res.group.group_manager = manager.data.nickname
            res.group.group_members = res.group.group_members.length
            res.group.group_events = res.group.group_events.length
            res.group.is_manager = isManager
            if (isManager) {
                res.group.waiting_members = res.group.waiting_members.length
                res.group.waiting_events = res.group.waiting_events.length
            } else {
                delete res.group['waiting_members']
                delete res.group['waiting_events']
            }

            return res
        case 'load_groups_allow_create':
            var res = {
                groups: [],
                groups_id: []
            }
            var _groups = await groups.where(
                    `(group_members == "${user.data._id}" && allow_member_create == ${true}) || group_manager == "${user.data._id}"`
                    )
                .get({
                    getCount: true
                })
            if (_groups.count === 0)
                return {
                    errCode: 0x21,
                    errMsg: "No group matched"
                }

            for (var g in _groups.data) {
                res.groups.push(_groups.data[g].group_name)
                res.groups_id.push(_groups.data[g]._id)
            }
            return res

    }
}
