require('dotenv').config()
const mongoose = require('mongoose')
const { BufferJSON } = require('@whiskeysockets/baileys')

mongoose.connect(process.env.MONGO_URL)
const COLLECTION = 'baileys_auth'

const Session = mongoose.model('Session', new mongoose.Schema({
    _id: String,
    session: String
}, { collection: COLLECTION }))

const reviver = (k, v) => {
    if (v && v.type === 'Buffer' && Array.isArray(v.data)) return Buffer.from(v.data)
    return v
}

const replacer = (k, v) => {
    if (Buffer.isBuffer(v)) return { type: 'Buffer', data: Array.from(v) }
    return v
}

exports.useMongoAuthState = async () => {
    const write = async (data, id) => {
        const session = JSON.stringify(data, replacer)
        await Session.updateOne({ _id: id }, { session }, { upsert: true })
    }
    const read = async (id) => {
        const doc = await Session.findById(id)
        if (!doc) return null
        return JSON.parse(doc.session, reviver)
    }
    const del = async (id) => {
        await Session.deleteOne({ _id: id })
    }

    const creds = await read('creds') || {}

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {}
                    await Promise.all(ids.map(async id => {
                        const value = await read(`${type}-${id}`)
                        if (value) data[id] = value
                    }))
                    return data
                },
                set: async (data) => {
                    await Promise.all(Object.keys(data).map(async type => {
                        await Promise.all(Object.keys(data[type]).map(async id => {
                            await write(data[type][id], `${type}-${id}`)
                        }))
                    }))
                }
            }
        },
        saveCreds: () => write(creds, 'creds')
    }
}
