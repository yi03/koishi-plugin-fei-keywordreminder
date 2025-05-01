import { Context, Schema, Session, h, $ } from 'koishi'
export const inject = ['database']

export const name = 'fei-keywordreminder'

export interface Config {}

export const Config: Schema<Config> = Schema.object({})

declare module 'koishi' {
    interface Tables {
        keywordRemind: KeywordRemind 
    }
}

export interface KeywordRemind {
    cid: string;
    uid: string;
    keyword: string;
    botId: string;
}

export function apply(ctx: Context) {

    ctx.model.extend('keywordRemind', {
        cid: "string",
        uid: "string",
        keyword: "string",
        botId: "string"
    },{
        primary: ['cid', 'uid', 'keyword', 'botId']
    })

    const keywordTemp = {};

    ctx.on('ready', async() => {
        await cidKeywordUpdate();
    })
    //更新
    async function cidKeywordUpdate() {
        Object.keys(keywordTemp).forEach(key => delete keywordTemp[key]);
        //通过集合来获取所有机器人实例的群列表
        const cidListSet = new Set<string>();
        await Promise.all(ctx.bots.map(async bot => {
            try {
                (await bot.getGuildList()).data.forEach(guild => {
                    cidListSet.add(guild.id);
                });
            }catch{}
        }));
        //把集合转换为群列表数组
        const cidListArr:Array<string> = Array.from(cidListSet)
        //通过获取到的群组列表，在keywordTemp中按群id储存该群的关键词数组
        await Promise.all(cidListArr.map(async cid => {
            keywordTemp[cid] = (await ctx.database.get('keywordRemind', { cid })).map((data => data.keyword));
        }));

        //从数据库中筛除已经无法获取的群提醒
        const invaildCidList = 
            (await ctx.database.select('keywordRemind').groupBy('cid').execute())
                .map(data => data.cid)
                .filter(cid => !cidListSet.has(cid));
        invaildCidList.forEach(async cid => {
            await ctx.database.remove('keywordRemind', { cid });
        });
    }

    ctx.command('提醒').action(async ({ session }) => {
        return `
本指令提供了关键词提醒功能
在触发关键词时会进行私聊提醒
指令列表：
提醒.群提醒 [关键词] [(可选)群id]
  -在指定群中提醒关键词
  -不指定群id则为当前群
提醒.全局提醒 [关键词]
  -在所有群中提醒关键词
提醒.删除 [要删除的关键词] [(可选)群id]
  -删除指定群中的关键词提醒
  -不指定群id则为当前群
提醒.列表
  -查看自己的关键词提醒列表`
    })

    ctx.command('提醒.群提醒','[关键词] [(可选)群id]').action(async ({ args, session }) => {
        if(args[0] === undefined) return '请输入群提醒关键词';
        const uid = session.event.user.id;
        const botId = session.bot.selfId;
        const keyword = args[0];
        //用户未输入群id
        if(args[1] === undefined) {
            const cid = session.event.channel.id;
            const cName =(await session.bot.getGuild(cid)).name
            try {
                await ctx.database.create('keywordRemind', {cid, uid, keyword, botId});
                await session.bot.sendPrivateMessage(uid, `在 ${cName}(${cid})中，当有人发送了关键词"${keyword}"时，我会提醒你哦~`);
                if (!keywordTemp[cid]) { // 检查是否存在
                    keywordTemp[cid] = []; // 不存在则初始化为空数组
                }
                keywordTemp[cid].push(keyword);
            }
            catch(err) {
                if (err.message.startsWith('Error with request send_private_msg'))
                    return h.at(uid) + ' 我没办法向你发送私聊提醒消息呀';
                else if(err.message.startsWith('UNIQUE constraint failed'))
                    return `该关键词已存在...`;
                else throw(err); 
            }
        }
        //用户输入了群id
        else {
            const cid = args[1];
            if((await session.bot.getGuildList()).data.map(guild => guild.id).some(id => id === cid) &&
            (await session.bot.getGuildMemberList(cid)).data.some(member => member.user.id === uid)) {
                const cName =(await session.bot.getGuild(cid)).name
                try {
                    await ctx.database.create('keywordRemind', {cid, uid, keyword, botId});
                    await session.bot.sendPrivateMessage(uid, `在 ${cName}(${cid})中，当有人发送了关键词"${keyword}"时，我会提醒你哦~`);
                    if (!keywordTemp[cid]) { // 检查是否存在
                        keywordTemp[cid] = []; // 不存在则初始化为空数组
                    }
                    keywordTemp[cid].push(keyword);
                }
                catch(err) {
                    if (err.message.startsWith('Error with request send_private_msg'))
                        return h.at(uid) + ' 我没办法向你发送私聊提醒消息呀';
                    else if(err.message.startsWith('UNIQUE constraint failed'))
                        return `该关键词已存在...`;
                    else throw(err); 
                }
            }
            else return `找不到该群，或者我和你没有同时在该群中...`
        }
        return `群提醒添加成功！`
    })

    ctx.command('提醒.全局提醒','[关键词]').action(async ({ session }, keyword) => {
        if(keyword === undefined) return '请输入全局提醒关键词' 
        const uid = session.event.user.id;
        const botId = session.bot.selfId;
        try {
            await session.bot.sendPrivateMessage(session.userId, `当有人发送了关键词"${keyword}"时，我会提醒你哦~`);
            //为每一个机器人和用户共同存在的群添加一个提醒
            await ctx.database.upsert('keywordRemind', [{cid: '全局', uid, keyword, botId}]);
            (await session.bot.getGuildList()).data.forEach(async guild => {
                const cid = guild.id;
                if ((await session.bot.getGuildMemberList(guild.id)).data.some(member => member.user.id === uid)) {
                    await ctx.database.upsert('keywordRemind', [{cid, uid, keyword, botId}]);
                    if (!keywordTemp[cid]) { // 检查是否存在
                        keywordTemp[cid] = []; // 不存在则初始化为空数组
                    }
                    keywordTemp[cid].push(keyword);
                }
            });
        }
        catch(err) {
            if (err.message.startsWith('Error with request send_private_msg'))
                return h.at(uid) + ' 我没办法向你发送私聊提醒消息呀';
            else throw(err); 
        }
        return `全局提醒添加成功！`
    })

    ctx.command('提醒.删除','[要删除的关键词] [(可选)群id]').action(async ({ args, session }) => {
        if(args[0] === undefined) return '请输入要删除的关键词'
        const uid = session.event.user.id;
        const botId = session.bot.selfId;
        const keyword = args[0];
        //用户未输入群id
        if(args[1] === undefined) {
            if((await ctx.database.get('keywordRemind', {keyword})).length === 0) return `该关键词不存在...`;
            await ctx.database.remove('keywordRemind', {uid, keyword, botId});
            await cidKeywordUpdate();
        }
        //用户输入了群id
        else {
            const cid = args[1];
            if((await ctx.database.get('keywordRemind', {keyword, cid})).length === 0) return `该关键词不存在...`;
            await ctx.database.remove('keywordRemind', {uid, keyword, cid, botId});
            await cidKeywordUpdate();
        }
        return `删除成功！`
    })

    ctx.command('提醒.列表').action(async ({ session }) => {
        const keywordCidList = {}
        const uid = session.event.user.id;
        const botId = session.bot.selfId;
        //利用数据库的groupby方法，获得用户的{'keyword1':[cid1, cid2, ...], 'keyword2': [...] ...}的对象
        await Promise.all(
            (await ctx.database.select('keywordRemind')
            .where({uid, botId}).groupBy('keyword').execute())
                //把获取到的用户的keyword列表(格式为[{keyword: 'keyword1'}, {keyword: ...} ...])的keyword
                //获取每个keyword的cid数组填入keywordCidList
                .map(async data => {
                    keywordCidList[data.keyword] = 
                        (await ctx.database.get('keywordRemind', {uid, keyword: data.keyword, botId}))
                        .map(data => data.cid.replace(/^.*:/, ''))
                })
        );
        //把cid数组中的每个cid转换为“群名(cid)”的格式
        await Promise.all(Object.keys(keywordCidList).map(async keyword => { 
                if (keywordCidList[keyword].includes('全局'))
                    keywordCidList[keyword] = ['全局']
                else
                    keywordCidList[keyword] = await Promise.all(keywordCidList[keyword].map(async cid => 
                    `${(await session.bot.getGuild(cid)).name}(${cid})`
                ))
            }
        ));
        if(Object.keys(keywordCidList).length === 0) return '您没有提醒词哦~'
        else return '您的提醒词列表：\n' + 
            Object.keys(keywordCidList)
            .map(keyword => {return `关键词：'${keyword}' —— ${keywordCidList[keyword].join(', ')}`})
            .join('\n');
    })

    //关键词监听
    ctx.on('message', async (session) => {
        const cid = session.event.channel.id;
        const botId = session.bot.selfId;
        const keywordlist:Array<string> = keywordTemp[cid];
        if(keywordlist !== undefined) {
            const keyword = keywordlist.find(keyword => session.content.includes(keyword));
            if(keyword !== undefined) {
                const senderUid = session.event.user.id;
                const uidList = (await ctx.database.get('keywordRemind', {cid, keyword, botId}))
                    .filter(data => data.uid !== senderUid).map(data => data.uid);
                if(uidList.length !== 0) {
                    uidList.forEach(async uid => {
                        try{
                        await session.bot.sendPrivateMessage(uid, `
${new Date().toLocaleString('zh-CN', { hour12: false })}
${session.event.user.name} (${senderUid}) 说：
${session.content.replace(new RegExp(keyword, 'g'), `【${keyword}】`)}
`);}
                        catch {session.send(h.at(uid) + ' 设置的提醒词发送私聊消息失败...')}
                    })
                }
            }
        }
    })

    //机器人自己加入某个群聊时，如果该群有开启了全局提醒的用户，则增加该群的关键词到数据库中
    ctx.on('guild-added', async (session) => {
        const cid = session.event.channel.id;
        const botId = session.bot.selfId;
        const globalKeywordUidList = (await ctx.database.select('keywordRemind').where({cid: '全局', botId}).groupBy('uid').execute()).map(data => data.uid);
        const guildUidList = (await session.bot.getGuildMemberList(cid)).data.map(member => member.user.id);
        for(const uid of globalKeywordUidList) {
            if(guildUidList.includes(uid)) {
                const keywordList = (await ctx.database.get('keywordRemind', {uid, botId, cid: '全局'})).map(data => data.keyword);
                for(const keyword of keywordList) {
                        await ctx.database.upsert('keywordRemind', [{cid, uid, keyword, botId}]);
                }
            }
        }
        cidKeywordUpdate();
    })
    //新成员加入群组时，如果该成员有设定全局提醒，则增加本群提醒到数据库中
    ctx.on('guild-member-added', async (session) => {
        const cid = session.event.channel.id;
        const botId = session.bot.selfId;
        const uid = session.event.user.id;
        (await ctx.database.get('keywordRemind', {uid, botId, cid: '全局'})).forEach(async data => {
            await ctx.database.upsert('keywordRemind', [{cid, uid, keyword: data.keyword, botId}]);
        })
        cidKeywordUpdate();
    })
    //成员离开群组时，删除该群的提醒
    ctx.on('guild-member-removed', async (session) => {
        const cid = session.event.channel.id;
        const botId = session.bot.selfId;
        const uid = session.event.user.id;
        await ctx.database.remove('keywordRemind', {uid, botId, cid});
        cidKeywordUpdate();
    })
}