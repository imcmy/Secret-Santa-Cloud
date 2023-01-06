'use strict';
const appid = ''
const secret = ''

exports.main = async (event, context) => {
	const JQL = uniCloud.databaseForJQL({
	    event,
	    context
	})
	const configurations = JQL.collection('configurations')
	
	let tokenUrl = 'https://api.weixin.qq.com/cgi-bin/token'
    let id = '63a8eed3e1a35c86f45ed885'
    
    let res = await uniCloud.httpclient.request(tokenUrl, {
        data: {
            appid: appid,
            secret: secret,
            grant_type: 'client_credential'
        },
        dataType: 'json'
    })
    
    await configurations.doc(id).update({
        "access_token": res.data.access_token
    })

	return true
};
