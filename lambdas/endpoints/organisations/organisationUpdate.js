const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Functions = require('../../common/Functions');

const validations = [
    {
        key: 'name',
        required: true,
        errorMsg: 'Please enter a valid organisation name',
    },
    {
        key: 'reference',
        required: true,
        errorMsg: 'Please enter a valid organisation name',
    },
    {
        key: 'contacts.lead.name',
        required: false,
        pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/),
        errorMsg: 'Please enter a valid lead contact name',
    },
    {
        key: 'contacts.secondary.name',
        required: false,
        pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/),
        errorMsg: 'Please enter a valid secondary contact name',
    },
    {
        key: 'contacts.lead.email',
        required: false,
        pattern: new RegExp(/^([a-z\d\-\.+]{1,50})@([a-z\d\-]{1,50})\.([a-z]{2,8})(\.[a-z]{2,8})?$/),
        errorMsg: 'Please enter a valid lead contact email address',
    },
    {
        key: 'contacts.secondary.email',
        required: false,
        pattern: new RegExp(/^([a-z\d\-\.+]{1,50})@([a-z\d\-]{1,50})\.([a-z]{2,8})(\.[a-z]{2,8})?$/),
        errorMsg: 'Please enter a valid secondary contact email address',
    },
    {
        key: 'contacts.lead.number',
        required: false,
        pattern: new RegExp(/[0-9+()\-\s]{8,30}/),
        errorMsg: 'Please enter a valid lead contact telephone number',
    },
    {
        key: 'contacts.secondary.number',
        required: false,
        pattern: new RegExp(/[0-9+()\-\s]{8,30}/),
        errorMsg: 'Please enter a valid secondary contact telephone number',
    }
];

exports.handler = async (event, context, cb) => {
    try {
        const parsed = event.requestId ? event : JSON.parse(event.body);

        if (!parsed) {
            return Responses._400({ message: 'Failed to read submitted data: '+JSON.stringify(parsed) });
        }
        const requestId = parsed.requestId;

        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }

        const tableName = process.env.ORGANISATIONS_TABLE;

        const organisationData = await Dynamo.get(
            {
                "requestId": requestId,
            }, 
            tableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!organisationData.requestId) {
            return Responses._200({ message: 'Record not found', result: false});
        }

        // use replace for extra layer of security
        const escapeRegEx = new RegExp(/(<([^>]+)>)/ig);

        const updateData = {
            ...organisationData
        }
        if (parsed.name) {
            updateData.name = parsed.name.toString().replace(escapeRegEx, '');
        }
        if (parsed.reference) {
            updateData.reference = parsed.reference.toString().replace(escapeRegEx, '');
        }
        if (parsed.contacts.lead.name) {
            updateData.leadContactName = parsed.contacts.lead.name.toString().replace(escapeRegEx, '');
        }
        if (parsed.contacts.lead.number) {
            updateData.leadContactNumber = parsed.contacts.lead.number.toString().replace(escapeRegEx, '').replace(' ', '');
        }
        if (parsed.contacts.lead.email) {
            updateData.leadContactEmail = parsed.contacts.lead.email.toString().replace(escapeRegEx, '');
        }
        if (parsed.contacts.secondary.name) {
            updateData.secondaryContactName = parsed.contacts.secondary.name.toString().replace(escapeRegEx, '');
        }
        if (parsed.contacts.secondary.number) {
            updateData.secondaryContactNumber = parsed.contacts.secondary.number.toString().replace(escapeRegEx, '').replace(' ', '');
        }
        if (parsed.contacts.secondary.email) {
            updateData.secondaryContactEmail = parsed.contacts.secondary.email.toString().replace(escapeRegEx, '');
        }


        await Dynamo.write(updateData, tableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        return Responses._200({ success: true });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};