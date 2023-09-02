const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications');

const AWS = require('aws-sdk');
AWS.config.update({region: 'eu-west-2'});
const cognito = new AWS.CognitoIdentityServiceProvider({
    apiVersion: "2016-04-18",
});

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }

        const userPoolId =  process.env.USER_POOL_V2;

        var params = {
            GroupName: 'Admin',
            UserPoolId: userPoolId,
        };
        const congitoGroupUsers = await cognito.listUsersInGroup(params).promise();
        let rtnUsers = [];
        if (congitoGroupUsers.Users && congitoGroupUsers.Users.length) {
            console.log(congitoGroupUsers.Users);
            
            rtnUsers = congitoGroupUsers.Users.map(u => {
                const emailObject = u.Attributes.find(a => a.Name === 'email').Value;
                console.log(emailObject);
                const fullNameObj = u.Attributes.find(a => a.Name === 'name');
                console.log(fullNameObj);
                var firstName = fullNameObj.Value.split(' ').slice(0, -1).join(' ');
                var lastName = fullNameObj.Value.split(' ').slice(-1).join(' ');
                return { 
                    email: emailObject,
                    firstName: firstName,
                    lastName: lastName,
                    createdAt: u.UserCreateDate, 
                    enabled: u.Enabled, 
                    status: u.UserStatus 
                }
            });
        }

        return Responses._200({ ...rtnUsers });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};