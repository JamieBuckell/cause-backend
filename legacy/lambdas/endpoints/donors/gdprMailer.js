const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications');

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }

        const envSalt = process.env.HASHING_SALT;
        const websiteURL = process.env.WEBSITE_URL;

        /* *
        const tableName = process.env.DONORS_TABLE;

        const params = {"TableName": tableName};
        const donorsData = await Dynamo.scan(params).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });
        /* */

        /* *
        const donorsData = [{
            requestId: 'c230a00a-6c6a-41b3-8ff0-f7ab09b31bc0',
            email: 'email@jamiebuckell.co.uk',
        }];
        /* */
        
        /* */
        const donorsData = [{
            requestId: '3a95ea01-2617-11ed-ab56-bf6614d0a021',
            email: 'laurabuckell24@gmail.com',
        }];
        /* */

        for (const donor of donorsData) {
            if (donor.verified) {
                continue;
            }
            // const toEmail = 'email@jamiebuckell.co.uk';
            const toEmail = donor.email;
            console.log(donor);

            const donorHash = Hashing.hash(donor.requestId, envSalt).hashedpassword;
            
            const jsonParameters = {
                ToAddresses: [toEmail],
                subject: "CAUSE Foundation - We'd like to stay in touch",
                pageTitle: "CAUSE Foundation - We'd like to stay in touch",
                pageContent: `Hi,
                <br /><br />
                As a former donor we would like to invite you to join our community and be kept up to date with our campaigns, stories and much more.
                <br /><br />
                Our 2022 Christmas Hamper Campaign drop off dates this year are Saturday 26th November to Monday 28th November and registration is now open.
                <br /><br />
                If you want to be kept up to date, then please click the button below and we'll add you to our mailing list.
                <br /><br />
                <a href="${websiteURL}/email-verification-i24?e=${encodeURIComponent(donor.email)}&v=${donorHash}" style="padding:16px 47px;margin:0 auto;background:#009643;border-radius:100px;font-weight:600;line-height:20px;letter-spacing:0.2px;color:#ffffff;text-decoration:none;display: block;width: max-content;">Keep me up to date</a>
                <br /><br />
                If you don't want to hear from us again, simply ignore this email.
                <br /><br />
                CAUSE Foundation Team`
            };
            // send the email using new validated params
            await Notifications.sendTransactionalEmail(jsonParameters);
        };

        return Responses._200({ messages: { 'success': 'Email Sending Complete' }});

    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};