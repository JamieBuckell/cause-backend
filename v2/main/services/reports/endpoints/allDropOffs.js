const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

const moment = require("moment-timezone");

exports.handler = async (event, context, cb) => {
  try {
    if (
      !Functions.hasPermission(event, "Admin") &&
      !Functions.hasPermission(event, "TeamLead") &&
      !Functions.hasPermission(event, "Nominator")
    ) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }
    const { campaignId } = event.pathParameters;
    if (!campaignId) {
      return Responses._401({
        messages: "Campaign ID is required",
      });
    }

    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const params = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk",
      ExpressionAttributeNames: {
        "#pk": "PK",
      },
      ExpressionAttributeValues: {
        ":pk": campaignId,
      },
    };
    let allCampaignData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    const allDropOffsData = [];

    const dropOffDates = allCampaignData
      .filter(
        (cd) =>
          cd?.type === "family" &&
          cd?.receiveStatus === "hamper-received" &&
          cd?.receivedDate
      )
      .map((h) => moment(h?.receivedDate).format("YYYYMMDD"));

    for (date of dropOffDates) {
      const timeData = allCampaignData
        .filter(
          (cd) =>
            cd?.type === "family" &&
            cd?.receiveStatus === "hamper-received" &&
            moment(cd?.receivedDate).format("YYYYMMDD") === date
        )
        .map((h) => parseFloat(moment(h?.receivedDate).format("HH.mm")));

      const finalTimeData = [
        { x: "0800", y: 0 },
        { x: "0815", y: 0 },
        { x: "0830", y: 0 },
        { x: "0845", y: 0 },
        { x: "0900", y: 0 },
        { x: "0915", y: 0 },
        { x: "0930", y: 0 },
        { x: "0945", y: 0 },
        { x: "1000", y: 0 },
        { x: "1015", y: 0 },
        { x: "1030", y: 0 },
        { x: "1045", y: 0 },
        { x: "1100", y: 0 },
        { x: "1115", y: 0 },
        { x: "1130", y: 0 },
        { x: "1145", y: 0 },
        { x: "1200", y: 0 },
        { x: "1215", y: 0 },
        { x: "1230", y: 0 },
        { x: "1245", y: 0 },
        { x: "1300", y: 0 },
        { x: "1315", y: 0 },
        { x: "1330", y: 0 },
        { x: "1345", y: 0 },
        { x: "1400", y: 0 },
        { x: "1415", y: 0 },
        { x: "1430", y: 0 },
        { x: "1445", y: 0 },
        { x: "1500", y: 0 },
        { x: "1515", y: 0 },
        { x: "1530", y: 0 },
        { x: "1545", y: 0 },
        { x: "1600", y: 0 },
        { x: "1615", y: 0 },
        { x: "1630", y: 0 },
        { x: "1645", y: 0 },
        { x: "1700", y: 0 },
        { x: "1715", y: 0 },
        { x: "1730", y: 0 },
        { x: "1745", y: 0 },
        { x: "1800", y: 0 },
        { x: "1815", y: 0 },
        { x: "1830", y: 0 },
      ];
      for (time of timeData) {
        let decimalValue = time.toString().indexOf(".");
        let minutes = time.toString().substring(decimalValue + 1);
        let hours = time.toString().substring(0, decimalValue);

        let key = "";
        if (minutes < 8) {
          key = `${hours}00`;
        } else if (minutes >= 8 && minutes < 23) {
          key = `${hours}15`;
        } else if (minutes >= 23 && minutes < 38) {
          key = `${hours}30`;
        } else if (minutes >= 38 && minutes < 53) {
          key = `${hours}45`;
        } else if (minutes >= 53) {
          key = `${(parseInt(hours) + 1).toString()}00`;
        }

        const foundIndex = finalTimeData.findIndex((td) => td.x === key);

        if (foundIndex >= 0) {
          finalTimeData[foundIndex].y++;
        }
      }

      finalTimeData.map((td) => {
        td.x = moment(`${date}T${td.x}`).toDate();
        return td;
      });

      allDropOffsData.push({
        name: `Date: ${date}`,
        data: finalTimeData,
      });
    }

    return Responses._200({
      allDropOffsData,
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
