const Responses = {
    _200(data = {}) {
        return {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Methods': '*',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Max-Age': '3600',
            },
            statusCode: 200,
            body: JSON.stringify(data),
        };
    },

    _400(data = {}) {
        console.log('400 Error: ', data);
        return {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Methods': '*',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Max-Age': '3600',
            },
            statusCode: 400,
            body: JSON.stringify(data),
        };
    },

    _401(data = {}) {
        return {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Methods': '*',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Max-Age': '3600',
            },
            statusCode: 401,
            body: JSON.stringify(data),
        };
    },
};

module.exports = Responses;