'use strict';
const crypto = require('crypto')
const qq_appid = ''
const qq_secret = ''
const wechat_appid = ''
const wechat_secret = ''

const genSessionId = function () {
    return crypto.randomBytes(16).toString('hex').slice(0, 32);
}

exports.main = async (event, context) => {
    const JQL = uniCloud.databaseForJQL({
        event,
        context
    })
    const users = JQL.collection('users')

    let source = context.SOURCE
    var params;
    if (source === 'http')
        params = event.queryStringParameters
    else if (source === 'function')
        params = event
    else
        return {
            errCode: 0x1,
            errMsg: "Context not supported"
        }

    if (params.platform === 'qq') {
        var appid = qq_appid
        var secret = qq_secret
        var loginUrl = 'https://api.q.qq.com/sns/jscode2session'
    } else if (params.platform === 'wechat') {
        var appid = wechat_appid
        var secret = wechat_secret
        var loginUrl = 'https://api.weixin.qq.com/sns/jscode2session'
    } else {
        return {
            errCode: 0x2,
            errMsg: "Parameters not supported"
        }
    }

    let res = await uniCloud.httpclient.request(loginUrl, {
        data: {
            appid: appid,
            secret: secret,
            js_code: params.code,
            grant_type: 'authorization_code'
        },
        dataType: 'json'
    })
    console.log(res)
    
    var query;
    if (params.platform === 'qq')
        query = {
            qq_openid: res.data.openid
        }
    else if (params.platform === 'wechat')
        query = {
            wx_openid: res.data.openid
        }
    
    let sessionId = genSessionId()
    let sessionExp = Date.now() + 15 * 60 * 1000
    
    if (source === 'function') {
        Object.assign(query, {
            session_id: sessionId,
            session_exp: sessionExp
        });
        return query
    }
    
    let user = await users.where(query).field('nickname,wishlist,groups,addresses').get({
        getOne: true
    })
    if (!user.data)
        return {
            errCode: 0x4,
            errMsg: "User does not exist"
        }
    
    await users.where({_id: user.data._id}).update({
        session_id: sessionId,
        session_exp: sessionExp
    })
    delete user.data['_id']
    
    return {
        user: user.data,
        session_id: sessionId,
        session_exp: sessionExp
    }
};
