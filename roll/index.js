'use strict';
const _ = uniCloud.database().command

// O(n) shuffle
const shuffle = arr => {
    let i = arr.length
    var temp
    while (i) {
        var j = Math.floor(Math.random() * i--)
        temp = arr[i]
        arr[i] = arr[j]
        arr[j] = temp
    }
}

exports.main = async (event, context) => {
    const JQL = uniCloud.databaseForJQL({
        event,
        context
    })
    let events = JQL.collection('events')
    let users = JQL.collection('users')
    let currTime = Date.now()
    
    var rolling = await events.where({
        event_rolled: false,
        event_audited: true,
        event_roll: _.lte(currTime)
    }).field('event_participates').getTemp()
    var rolling_user = users.field('_id,nickname').getTemp()
    rolling = await JQL.collection(rolling, rolling_user).get()
    for (var i = 0, len = rolling.data.length; i < len; i++) {
        var event_pairs = {
            nicknames: [],
            pairs: {},
            results: []
        }
        var member_counts = rolling.data[i].event_participates.length
        rolling.data[i].event_participates.map(o => {
            event_pairs.nicknames.push(o.nickname)
        })
        shuffle(rolling.data[i].event_participates)
        for (var seq = 0; seq < member_counts; seq++) {
            var member = rolling.data[i].event_participates[seq]
            event_pairs.pairs[member._id] = {
                target: rolling.data[i].event_participates[(seq + 1) % member_counts]._id,
                sequential: seq + 1
            }
        }
        rolling.data[i].event_participates.map(o => {
            event_pairs.results.push(o.nickname)
        })
        if (event_pairs.results.length > 0)
            event_pairs.results.push(event_pairs.results[0])
        await events.doc(rolling.data[i]._id).update({
            event_rolled: true,
            event_pairs: event_pairs
        })
    }
    
    await events.where({
        event_rolled: true,
        event_ended: false,
        event_audited: true,
        event_end: _.lte(currTime)
    }).update({
        event_ended: true
    })

    return true
};
