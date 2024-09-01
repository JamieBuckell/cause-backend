const Dynamo = require("./Dynamo");
var AWS = require("aws-sdk");
AWS.config.region = "eu-west-2";
var lambda = new AWS.Lambda();

const commsTemplateTableName = process.env.EMAIL_TEMPLATES_TABLE;

const Functions = {
  timer(ms) {
    return new Promise((res) => setTimeout(res, ms));
  },
  hasPermission(event, permission) {
    if (event?.requestContext?.authorizer) {
      if (event.requestContext.authorizer?.claims["cognito:groups"]) {
        const allGroups =
          event.requestContext.authorizer.claims["cognito:groups"].split(",");
        return allGroups.find((p) => p === permission);
      }
    }
    return false;
  },
  numToSSColumn: (num) => {
    var s = "",
      t;

    while (num > 0) {
      t = (num - 1) % 26;
      s = String.fromCharCode(65 + t) + s;
      num = ((num - t) / 26) | 0;
    }
    return s || undefined;
  },
  getUsersUniqueReference: (fullName) => {
    /*
        let rgx = new RegExp(/(\p{L}{1})\p{L}+/, 'gu');

        let initials = [...fullName.matchAll(rgx)] || [];

        initials = (
        (initials.shift()?.[1] || '') + (initials.pop()?.[1] || '')
        ).toUpperCase();
        */
    let initials = fullName
      .replace("-", " ")
      .match(/(\b\S)?/g)
      .join("")
      .toUpperCase();
    return initials;
  },
  buildFamilyRequestHTML(families) {
    let rtnHTML = ``;
    let familyCount = 0;
    let prefCount = 0;
    if (families.length) {
      for (const [i, item] of families.entries()) {
        familyCount += item.numberOfFamilies;

        const preferences =
          typeof item.familyDetail === "string"
            ? JSON.parse(item.familyDetail)
            : item.familyDetail;
        for (const p of preferences) {
          prefCount++;
          rtnHTML += `
                        <br /><br />
                        <strong>Hamper ${prefCount}:</strong> `;
          switch (p.toLowerCase()) {
            case "single":
              rtnHTML += "Single Person";
              break;
            case "small":
              rtnHTML += "Small Family - 2 - 3 family members";
              break;
            case "medium":
              rtnHTML += "Medium Family - 4 - 5 family members";
              break;
            case "large":
              rtnHTML += "Large Family - 6 - 7 family members";
              break;
            case "extralarge":
              rtnHTML += "Extra Large Family - 8+ family members";
              break;
            default:
              rtnHTML += "No Preference";
              break;
          }
        }

        rtnHTML += `
                ${
                  item.additionalInfo
                    ? "<br /><br /><strong>Additional Information:</strong><br />" +
                      item.additionalInfo
                    : ""
                }`;
      }
    }
    rtnHTML =
      `
            <strong>Number of Hampers:</strong> ${familyCount}` + rtnHTML;

    return rtnHTML;
  },
  buildDonorAllocationHTML(families, hideHamperId) {
    let rtnHTML = ``;
    console.log(families);
    if (families && families.length) {
      if (families.length >= 5) {
        rtnHTML +=
          "Due to the number of families allocated, we have attached a CSV containing your family allocation details.<br /><br />";
      } else {
        for (const [i, f] of families.entries()) {
          if (!hideHamperId) {
            rtnHTML += `
                        <strong>Hamper ID:</strong> ${f.reference}<br />`;
          } else {
            rtnHTML += `
                        <strong>Hamper ${i + 1}:</strong><br />`;
          }
          rtnHTML += `
                        <strong>Family Size:</strong>  ${f.totalUnit}<br />
                        <strong>Family Dynamics</strong><br />`;
          if (f.members.length) {
            const currentFamilyMembers = [...f.members];
            currentFamilyMembers.sort((a, b) =>
              b.age > a.age ? 1 : a.age > b.age ? -1 : 0
            );

            rtnHTML += `
                        <table>`;

            for (const [j, fm] of currentFamilyMembers.entries()) {
              rtnHTML += `
                        <tr>`;
              rtnHTML += `
                            <td style="padding-right: 30px;">${fm.who}${
                fm.whoOther ? " (" + fm.whoOther + ")" : ""
              }</td>
                            <td style="padding-right: 30px;">${fm.age} ${
                fm.age ? fm.ageType : ""
              }</td>
                            <td>${
                              fm.additionalInfo ? fm.additionalInfo : ""
                            }</td>`;
              rtnHTML += `
                        </tr>`;
            }

            rtnHTML += `
                        </table>`;
          }
          rtnHTML += `
                        <br /><br />`;
        }
      }
    }

    return rtnHTML;
  },
  async checkValue(keys, obj) {
    let returnValue = "";
    let checkObj = { ...obj };
    let i = 0;
    for (const key of keys) {
      i++;
      if (checkObj[key]) {
        checkObj = checkObj[key];
        returnValue = checkObj;
      } else {
        returnValue = null;
      }
    }
    return returnValue;
  },
  async validateSubmission(submission, validations) {
    const standards = {
      email: {
        pattern: new RegExp(
          /^([a-z\d\-\.\+]{1,50})@([a-z\d\-]{1,50})\.([a-z]{2,8})(\.[a-z]{2,8})?$/i
        ),
        errorMsg: "Please enter a valid email address",
      },
    };

    const errors = {};

    for (const v of validations) {
      const validationSubmission = await Functions.checkValue(
        v.key.split("."),
        submission
      );
      //Don't do anything if it's not required and they've not submitted anything!
      if (
        !(
          !v.required &&
          (validationSubmission == undefined ||
            validationSubmission == "" ||
            validationSubmission == null)
        )
      ) {
        if (
          v.required &&
          (validationSubmission == undefined ||
            validationSubmission == "" ||
            validationSubmission == null)
        ) {
          errors[v.key] = v.errorMsg;
        } else if (v.type && standards[v.type]) {
          if (
            !standards[v.type].pattern.test(validationSubmission.toString())
          ) {
            errors[v.key] = standards[v.type].errorMsg;
          }
        } else if (
          v.pattern &&
          !v.pattern.test(validationSubmission.toString())
        ) {
          errors[v.key] = v.errorMsg;
        }
      }
    }

    if (errors.length) {
      console.log("Errors: ", errors, submission, validations);
    }

    return errors;
  },
  shuffle(array) {
    var currentIndex = array.length,
      randomIndex;

    // While there remain elements to shuffle...
    while (currentIndex != 0) {
      // Pick a remaining element...
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex--;

      // And swap it with the current element.
      [array[currentIndex], array[randomIndex]] = [
        array[randomIndex],
        array[currentIndex],
      ];
    }

    return array;
  },
  getRandomChar(str) {
    return str.charAt(Math.floor(Math.random() * str.length));
  },
  generateP(options) {
    const groups = options?.groups ?? [
      //    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      //    'abcdefghijklmnopqrstuvwxyz',
      "1234567890",
      //    '!@#$%^&()_+~`|}{[]:;?><,./-=',
      //    '^$*.[]{}()?-"!@#%&/\\,><\':;|_~`+='
    ];
    const length = options?.length ?? 16;
    let pass = groups.map(this.getRandomChar).join("");

    const str = groups.join("");

    for (let i = pass.length; i <= length; i++) {
      pass += this.getRandomChar(str);
    }
    return this.shuffle(pass);
  },
  createDetailPreview(template, params) {
    switch (template) {
      case "familyDetail":
        var rtnString = "";
        for (const [key, m] of Object.entries(params.members)) {
          rtnString += `
                    <div class="row">
                        <div class="col-12">
                            <strong>
                            ${m.who}${m.whoOther ? " (" + m.whoOther + ")" : ""}
                            </strong>
                            ${m.age} ${m.age ? m.ageType : ""}
                            ${
                              m.additionalInfo
                                ? "<br />Info: " + m.additionalInfo
                                : ""
                            }
                        </div>
                    </div>
                    `;
        }
        return rtnString;
      case "workerDetail":
        var rtnStr = `<strong>${params.firstName} ${params.lastName}</strong>`;
        if (params.telephone) {
          rtnStr += ` - <a href="tel:${params.telephone}">${params.telephone}</a>`;
        }
        if (params.email) {
          rtnStr += `<br /><a href="tel:${params.email}">${params.email}</a>`;
        }
        return rtnStr;
    }
    return "";
  },
  replaceEmailPlaceholders(content, params) {
    const placeholderRegex =
      /((%3C%3C)|(&lt;&lt;)|(<<))([a-zA-Z\.0-9]+)((>>)|(&gt;&gt;)|(%3E%3E))/gm;
    const placeholderMatches = content.match(placeholderRegex);

    if (placeholderMatches && placeholderMatches.length) {
      for (const match of placeholderMatches) {
        const placeholder = match.replace(
          /((%3C%3C)|(&lt;&lt;)|(<<)|(>>)|(&gt;&gt;)|(%3E%3E))/gm,
          ""
        );

        switch (placeholder.toUpperCase()) {
          case "DONOR.FIRSTNAME":
            content = content.replace(
              match,
              params?.donorData?.firstName ?? ""
            );
            break;
          case "DONOR.LASTNAME":
            content = content.replace(match, params?.donorData?.lastName ?? "");
            break;
          case "DONOR.EMAIL":
            content = content.replace(match, params?.donorData?.email ?? "");
            break;
          case "DONOR.TELEPHONE":
            content = content.replace(
              match,
              params?.donorData?.telephone ?? ""
            );
            break;
          case "REQUEST.FAMILY":
            content = content.replace(
              match,
              this.buildFamilyRequestHTML(params.familyData)
            );
            break;

          case "DONOR.COMPANY":
            content = content.replace(match, params?.donorData?.company ?? "");
            break;
          case "ORGANISATION.NAME":
            content = content.replace(match, params?.companyName ?? "");
            break;
          case "NOMINATOR.FIRSTNAME":
            content = content.replace(
              match,
              params?.nominator?.firstName ?? ""
            );
            break;
          case "NOMINATOR.LASTNAME":
            content = content.replace(match, params?.nominator?.lastName ?? "");
            break;
          case "NOMINATOR.FULLNAME":
            content = content.replace(match, params?.nominator?.name ?? "");
            break;
          case "NOMINATOR.EMAIL":
            content = content.replace(match, params?.nominator?.email ?? "");
            break;
          case "NOMINATOR.PASSWORD":
            content = content.replace(match, params?.nominator?.password ?? "");
            break;
          case "NOMINATOR.REGISTRATION.LINK":
            content = content.replace(
              match,
              params?.nominatorRegisterLink ?? ""
            );
            break;
          case "NOMINATOR.RESETPASSWORD.LINK":
            content = content.replace(match, params?.resetPasswordLink ?? "");
            break;
          case "PASSWORD.TEMPORARY":
            content = content.replace(match, params?.temporaryPassword ?? "");
            break;
          case "DONOR.EMAIL.VERIFY.LINK":
            content = content.replace(
              match,
              `${params.appURL}/subscription/verify/${encodeURIComponent(
                params.emailAddress
              )}?v=${params.donorHash}&c=${params.campaignId}`
            );
            break;
          case "DONOR.PLEDGE.ACCEPT":
            content = content.replace(
              match,
              `${
                params.appURL
              }/pledge-confirmation?t=accept&e=${encodeURIComponent(
                params.emailAddress
              )}&v=${params.donorHash}${
                params?.campaignRequestId
                  ? "&c=" + params.campaignRequestId
                  : ""
              }`
            );
            break;
          case "DONOR.PLEDGE.CHANGE":
            content = content.replace(
              match,
              `${
                params.appURL
              }/pledge-confirmation?t=change&e=${encodeURIComponent(
                params.emailAddress
              )}&v=${params.donorHash}${
                params?.campaignRequestId
                  ? "&c=" + params.campaignRequestId
                  : ""
              }`
            );
            break;
          case "ALLOCATION.DATA":
            content = content.replace(
              match,
              params?.familyData
                ? this.buildDonorAllocationHTML(params.familyData, false)
                : ""
            );
            break;
          case "ALLOCATION.DATA.NOID":
            content = content.replace(
              match,
              params?.familyData
                ? this.buildDonorAllocationHTML(params.familyData, true)
                : ""
            );
            break;
          case "PORTAL.URL":
            content = content.replace(
              match,
              `<a href="${params?.appURL ?? ""}">${params?.appURL ?? ""}</a>`
            );
            break;
          default:
            content = content.replace(match, "");
            console.log("UNKNOWN", placeholder);
            break;
        }
      }
    }

    return content;
  },
  async getEmailTemplate(template, params) {
    const commsTemplateQueryData = {
      KeyConditionExpression: "#pk= :pk And begins_with(#sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": template,
        ":sk": "SK#",
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
      },
    };
    const dbTemplate = await Dynamo.query(
      commsTemplateQueryData,
      commsTemplateTableName
    ).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    if (dbTemplate) {
      const templateObject = dbTemplate[0];
      templateObject.pageContent = this.replaceEmailPlaceholders(
        templateObject.pageContent,
        params
      );
      return templateObject;
    }

    switch (template) {
      case "adminNewNominator":
        return {
          subject: "CAUSE Foundation: New Nominator Registration",
          pageTitle: "",
          pageContent: `Hello,
                    <br /><br />
                    You've just had a new nominator register themselves to your team/organisation: ${
                      params.companyName ?? ""
                    }.
                    <br /><br />
                    Name: ${params.nominator.name ?? ""}<br />
                    Email: ${params.nominator.email ?? ""}
                    <br /><br />
                    Please log into the Web Portal (<a href="${
                      params.appURL
                    }">${
            params.appURL
          }</a>) and approve this nominator to ensure their nominations can be allocated.
                    <br /><br />
                    Kind Regards,<br />
                    The CAUSE Foundation team`,
        };
      case "newNominatorConfirmation":
        return {
          subject: "CAUSE Foundation: Registration Details",
          pageTitle: "Your registration details",
          pageContent: `Hi ${params.nominator.firstName ?? ""},
                    <br /><br />
                    Thank you for registering on the CAUSE Foundation nominators portal.
                    <br /><br />
                    To log in to the portal you'll need to use the following details:<br />
                    Web Portal URL: <strong><a href="${params.appURL ?? ""}">${
            params.appURL ?? ""
          }</a></strong><br />
                    Username: <strong>${
                      params.nominator.email ?? ""
                    }</strong><br />
                    Password: <strong>${
                      params.nominator.password ?? ""
                    }</strong>
                    <br /><br />
                    For security reasons, once you're logged in you will be asked to change your password.
                    <br /><br />
                    Kind Regards,<br />
                    The CAUSE Foundation team`,
        };
      case "nominatorResetConfirmation":
        return {
          subject: "CAUSE Foundation: Account Reset",
          pageTitle: "Password reset",
          pageContent: `Hi ${params.nominator.firstName ?? ""},
                    <br /><br />
                    Your account has been reset by a CAUSE admin.
                    <br /><br />
                    To log in to the portal you'll need to use the following details:<br />
                    Web Portal URL: <strong><a href="${params.appURL ?? ""}">${
            params.appURL ?? ""
          }</a></strong><br />
                    Username: <strong>${
                      params.nominator.email ?? ""
                    }</strong><br />
                    Password: <strong>${
                      params.nominator.password ?? ""
                    }</strong>
                    <br /><br />
                    For security reasons, once you're logged in you will be asked to change your password.
                    <br /><br />
                    <a href="${params.appURL}">${params.appURL}</a>
                    <br /><br />
                    Kind Regards,<br />
                    The CAUSE Foundation team`,
        };
      case "donorRegister":
        return {
          subject: "CAUSE Foundation: Email address verification",
          pageTitle: "Email verification",
          pageContent: `Thank you for registering your preferences, before we can allocate your hampers we just need to verify your email address.
                    <br /><br />
                    Simply click the green button below to verify your email address.
                    <br /><br />
                    Thanks! The CAUSE Foundation team
                    <br /><br /><br />
                    <a href="${
                      params.appURL
                    }/subscription/verify/${encodeURIComponent(
            params.emailAddress
          )}?v=${params.donorHash}&c=${
            params.campaignId
          }" style="padding:16px 47px;margin:0 auto;background:#009643;border-radius:100px;font-weight:600;line-height:20px;letter-spacing:0.2px;color:#ffffff;text-decoration:none;display: block;width: max-content;">Verify your email</a>`,
        };
      case "donorVerified":
        return {
          subject: "CAUSE Foundation: Hamper request confirmation",
          pageTitle: "Hamper request confirmation",
          pageContent: `Thank you for registering your preferences and verifying your email, we have received your request and will email you as soon as we allocate your famil${
            params.familyData.length > 1 ? "ies" : "y"
          }.
                    <br /><br />
                    Your preference request details are:
                    <br /><br />
                    <strong>Your Name:</strong> ${params.donorData.firstName} ${
            params.donorData.lastName
          }<br />
                    ${
                      params.donorData.company
                        ? "<strong>Company:</strong> " +
                          params.donorData.company +
                          "<br />"
                        : ""
                    }
                    <strong>Email Address:</strong> ${
                      params.donorData.email
                    }<br />
                    ${
                      params.donorData.telephone
                        ? "<strong>Contact Number:</strong> " +
                          params.donorData.telephone +
                          "<br />"
                        : ""
                    }
                    <br />
                    ${this.buildFamilyRequestHTML(params.familyData)}
                    <br /><br />
                    Kind Regards,<br />
                    Christmas Hamper Campaign Team`,
        };
      case "donorRegisterSubsequent":
        return {
          subject: "CAUSE Foundation: Hamper request confirmation",
          pageTitle: "Hamper request confirmation",
          pageContent: `Thank you for registering for another hamper, we have received your request and will email you as soon as we allocate your famil${
            params.familyCount > 1 ? "ies" : "y"
          }.
                  <br /><br />
                  Your preference request details are:
                  <br /><br />
                  <strong>Your Name:</strong> ${params.donorData.firstName} ${
            params.donorData.lastName
          }<br />
                  ${
                    params.donorData.company
                      ? "<strong>Company:</strong> " +
                        params.donorData.company +
                        "<br />"
                      : ""
                  }
                  <strong>Email Address:</strong> ${
                    params.donorData.email
                  }<br />
                  ${
                    params.donorData.telephone
                      ? "<strong>Contact Number:</strong> " +
                        params.donorData.telephone +
                        "<br />"
                      : ""
                  }
                  <br />
                  ${this.buildFamilyRequestHTML(params.familyData)}
                  <br /><br />
                  Kind Regards,<br />
                  Christmas Hamper Campaign Team`,
        };
      case "pledgeUpdated":
        return {
          subject: "CAUSE Foundation: Hamper request update",
          pageTitle: "Hamper request was updated",
          pageContent: `Your updated preference request details are:
                    <br /><br />
                    ${this.buildFamilyRequestHTML(params.familyData)}
                    <br /><br />
                    We will be in touch with your nominated family details at a later date.
                    <br /><br />
                    Kind Regards,<br />
                    Christmas Hamper Campaign Team`,
        };
      case "organisationAdminAccount":
        return {
          subject: "Welcome to the CAUSE Foundation system",
          pageContent: `<strong>Do not share this email with anyone as it contains your unique security information.</strong><br /><br /> Hello,
                    <br /><br />
                    We are pleased to announce that nominations are now open for the 2023 CAUSE Christmas Hamper Campaign.
                    <br /><br />
                    You have been identified as the primary contact for your organisation / team and that is why you have received this email. If you are NOT the primary contact, please let us know via <a href="mailto:hampers@cause-foundation.org.uk">hampers@cause-foundation.org.uk</a> or by replying to this email.
                    <br /><br />
                    To log in to the portal you'll need to use the following details:<br />
                    Web Portal URL: <strong><a href="${params.appURL}">${params.appURL}</a></strong><br />
                    Username: <strong>${params.nominator.email}</strong><br />
                    Password: <strong>${params.nominator.password}</strong>
                    <br /><br />
                    For security reasons, once you're logged in you will be asked to change your password.
                    <br /><br />
                    You can nominate families and you can also invite other team members so they can nominate families. However, YOU must approve team members so that their nominations are valid.
                    <br /><br />
                    Once you log in, you will recieve another email containing details on how your team members can register to submit their nominations.                    
                    <br /><br />
                    Kind Regards,<br />
                    Christmas Hamper Campaign Team`,
        };
      case "organisationAdminWelcome":
        return {
          subject: "CAUSE Foundation: Nomination system details",
          pageContent: `<strong>Forward this email to anyone you wish to be a nominator for your team/organisation</strong>
                    <br /><br />
                    Hello,
                    <br /><br />
                    We are pleased to announce that our 2023 Christmas Hamper Campaign is now open for nominations.
                    <br /><br />
                    As you know, last year we had a new bespoke nomination system in place and all the team leads from this system have been retained on the system. However, it was not viable to retain the other team members who nominated last year as many leave or change teams during the year.
                    <br /><br />
                    This means if anyone on your team wishes to nominate families, they need to register again - same process as last year using the link below.  The link is unique to your organisation/team, so please do not share it outside of your organisation/team.
                    <br /><br />
                    <a href="${params.nominatorRegisterLink}">${params.nominatorRegisterLink}</a>
                    <br /><br />
                    Once again, we are on a very strict timetable this year so nominations will close on Friday 6 October 2023.
                    <br /><br />
                    <strong>Points to consider before nominating:</strong><br />
                    <ul>
                    <li>Please consider carefully if the family really needs our help - our hampers are only intended for those in <strong>genuine financial hardship</strong>.</li>
                    <li>Please <strong>prioritise</strong> your nominations as we may not be able to provide hampers for each family nominated.</li>
                    <li>If the family has multi-agency involvement, please check with other agencies to ensure <strong>no duplicates</strong> e.g nominated by school and/or local authority teams.</li>
                    </ul>
                    <br />
                    <strong>Dates for your diary:</strong><br />
                    <ul>
                    <li>Collections from MFC - Tuesday 5th December & Wednesday 6th December.</li>
                    <li>School to School Collections/Deliveries - week beginning 11th December.</li>
                    </ul>
                    <br />
                    Please bear with us if you encounter any issues - everyone involved with CAUSE Foundation is a volunteer and has other work/family commitments, but we will get back to you as soon as we can.
                    <br /><br />
                    Kind Regards,<br />
                    Christmas Hamper Campaign Team`,
        };
      case "userPasswordResetInit":
        return {
          subject: "CAUSE Foundation: Password Reset",
          pageTitle: "Password Reset",
          pageContent: `Hi ${params.nominator.firstName ?? ""},
                    <br /><br />
                    We have received a password reset request for your account.
                    <br /><br />
                    <strong>If this was not you, please let us know immediately.</strong>
                    <br /><br />
                    If this was you, please use the link below to reset your password:<br />
                    <a href="${params.resetPasswordLink}">${
            params.resetPasswordLink
          }</a>
                    <br /><br />
                    Kind Regards,<br />
                    The CAUSE Foundation team`,
        };
      case "userPasswordResetConfirm":
        return {
          subject: "CAUSE Foundation: Password Reset Success",
          pageTitle: "Password Reset",
          pageContent: `Hi ${params.nominator.firstName ?? ""},
                    <br /><br />
                    Your password has successfully been reset.
                    <br /><br />
                    To log in you'll need to use the following password: <strong>${
                      params.temporaryPassword
                    }</strong>
                    <br /><br />
                    For security reasons, once you're logged in you will be asked to change your password.
                    <br /><br />
                    <a href="${params.appURL}">${params.appURL}</a>
                    <br /><br />
                    Kind Regards,<br />
                    The CAUSE Foundation team`,
        };
      case "donorFamilyAllocation":
        return {
          subject: "CAUSE Foundation: 2023 Christmas Hamper Allocation",
          pageTitle:
            "THANK YOU FOR SUPPORTING OUR 2023 CHRISTMAS HAMPER CAMPAIGN",
          pageContent: `Firstly, a huge thank you for registering to provide a hamper this Christmas - it truly makes a huge difference to the recipient and we cannot thank you enough.
                    <br /><br />
                    We know that circumstances can change very quickly, so it is <strong>VERY IMPORTANT</strong> that you let us know if you are happy with your allocation and are still able to provide a hamper/s using the <strong>ACCEPT</strong> button at the bottom of this email. 
                    <br /><br />
                    <strong>Your Allocation</strong><br />
                    ${this.buildDonorAllocationHTML(params.familyData, true)}
                    Once you confirm your allocation we'll send another email with your hamper ID's and labels.
                    <br /><br />
                    <table width="100%" cellpadding="20px" cellspacing="0" style="width:100%;">
                    <tr><td style="padding:0 20px;">
                        
                    </td>
                    <td style="padding:0 20px;">
                        <a href="${
                          params.appURL
                        }/pledge-confirmation?t=change&e=${encodeURIComponent(
            params.emailAddress
          )}&v=${params.donorHash}${
            params?.campaignRequestId ? "&c=" + params.campaignRequestId : ""
          }" style="display:block;padding:16px 47px;margin:0 auto 0 0;background:#FBA94A;border-radius:100px;font-weight:600;line-height:20px;letter-spacing:0.2px;color:#ffffff;text-decoration:none;width: max-content;">Change</a>
                    </td></tr>
                    </table>
                    <br /><br />
                    Thank you so much for your continued support. We could not do this without you and your donation will make a massive difference to the families.
                    <br /><br />
                    <strong>CAUSE CHRISTMAS HAMPER TEAM</strong>
                    `,
        };
      case "donorFamilyAllocationConfirmed":
        return {
          subject: "CAUSE Foundation: 2023 Christmas Hamper Confirmation",
          pageTitle: "THANK YOU FOR ACCEPTING YOUR HAMPER ALLOCATION",
          pageContent: `Thank you for accepting your hamper allocation.
                    <br /><br />
                    Below are all the details you should need to complete your hamper(s).
                    <br /><br />
                    <strong>What to include</strong><br />
                    Please visit <a href="https://www.cause-foundation.org.uk/how-does-it-work-i21">https://www.cause-foundation.org.uk/how-does-it-work-i21</a> for more information.
                    <br /><br />
                    <strong>ID Label</strong><br />
                    Once you have your hamper ready, it is very important that <strong>EVERY BAG</strong> has a label attached to ensure the hamper is delivered to the correct family. A PDF is included in this email and is populated with the Hamper ID(s) to make things easier. The first bag will have 2 labels - please ensure these are attached separately as the identification label with your name will be removed before the hamper is delivered. 
                    <br /><br />
                    <strong>Dropping off your donation</strong><br />
                    Middlesbrough FC have kindly allowed us to once again use the <strong>SOUTH STAND</strong> for hamper drop offs as follows:<br />
                    <strong>FRIDAY 1st DECEMBER 2023 9.00am - 6.OOpm</strong><br />
                    <strong>SATURDAY 2nd DECEMBER 2023 9.00am - 4.00pm</strong><br />
                    <strong>SUNDAY 3rd DECEMBER 2023 10.00am - 4.00pm </strong>
                    <br /><br />
                    Please look out for traffic signs which will guide you to the drop location
                    <br /><br />
                    <strong>FAQ's</strong><br />
                    Please check out our FAQ section using the link below for answers to questions you may have before contacting us with a query<br />
                    <a href="https://www.cause-foundation.org.uk/helpdesk">https://www.cause-foundation.org.uk/helpdesk</a>
                    <br /><br />
                    <strong>Your Allocation</strong><br />
                    ${this.buildDonorAllocationHTML(params.familyData, false)}
                    Thank you once again for supporting us - it really makes a difference to the families. 
                    <br /><br />
                    Wishing you all a wonderful Christmas and a very Happy New Year.
                    <br /><br />
                    <strong>CAUSE CHRISTMAS HAMPER TEAM</strong>`,
        };
      case "donorFamilyAllocationReminder1":
        return {
          subject: "CAUSE Foundation: Christmas Hamper Allocation Reminder",
          pageTitle: "ALLOCATION REMINDER",
          pageContent: `Hello, it's been a couple of days since we allocated your hamper. Please can you confirm if you are happy with your allocation and are still able to provide a hamper/s using the <strong>ACCEPT</strong> button at the bottom of this email.
                    <br /><br />
                    <strong>Your Allocation</strong><br />
                    ${this.buildDonorAllocationHTML(params.familyData, true)}
                    Once you confirm your allocation we'll send another email with your hamper ID's and labels.
                    <br /><br />
                    <table width="100%" cellpadding="20px" cellspacing="0" style="width:100%;">
                    <tr><td style="padding:0 20px;">
                        <a href="${
                          params.appURL
                        }/pledge-confirmation?t=accept&e=${encodeURIComponent(
            params.emailAddress
          )}&v=${params.donorHash}${
            params?.campaignRequestId ? "&c=" + params.campaignRequestId : ""
          }" style="display:block;padding:16px 47px;margin:0 0 0 auto;background:#009643;border-radius:100px;font-weight:600;line-height:20px;letter-spacing:0.2px;color:#ffffff;text-decoration:none;width: max-content;">Accept</a>
                    </td>
                    <td style="padding:0 20px;">
                        <a href="${
                          params.appURL
                        }/pledge-confirmation?t=change&e=${encodeURIComponent(
            params.emailAddress
          )}&v=${params.donorHash}${
            params?.campaignRequestId ? "&c=" + params.campaignRequestId : ""
          }" style="display:block;padding:16px 47px;margin:0 auto 0 0;background:#FBA94A;border-radius:100px;font-weight:600;line-height:20px;letter-spacing:0.2px;color:#ffffff;text-decoration:none;width: max-content;">Change</a>
                    </td></tr>
                    </table>
                    <br /><br />
                    Thank you so much for your continued support. We could not do this without you and your donation will make a massive difference to the families.
                    <br /><br />
                    <strong>CAUSE CHRISTMAS HAMPER TEAM</strong>
                    `,
        };
      case "donorFamilyAllocationReminder2":
        return {
          subject: "CAUSE Foundation: Christmas Hamper Allocation Reminder",
          pageTitle: "ALLOCATION REMINDER",
          pageContent: `Hello, it's been 4 days since we allocated your hamper. Please can you confirm if you are happy with your allocation and are still able to provide a hamper/s using the <strong>ACCEPT</strong> button at the bottom of this email.
                    <br /><br />
                    If you do not accept your hamper we will automatically remove your allocation to assign to another donor.
                    <br /><br />
                    <strong>Your Allocation</strong><br />
                    ${this.buildDonorAllocationHTML(params.familyData, true)}
                    Once you confirm your allocation we'll send another email with your hamper ID's and labels.
                    <br /><br />
                    <table width="100%" cellpadding="20px" cellspacing="0" style="width:100%;">
                    <tr><td style="padding:0 20px;">
                        <a href="${
                          params.appURL
                        }/pledge-confirmation?t=accept&e=${encodeURIComponent(
            params.emailAddress
          )}&v=${params.donorHash}${
            params?.campaignRequestId ? "&c=" + params.campaignRequestId : ""
          }" style="display:block;padding:16px 47px;margin:0 0 0 auto;background:#009643;border-radius:100px;font-weight:600;line-height:20px;letter-spacing:0.2px;color:#ffffff;text-decoration:none;width: max-content;">Accept</a>
                    </td>
                    <td style="padding:0 20px;">
                        <a href="${
                          params.appURL
                        }/pledge-confirmation?t=change&e=${encodeURIComponent(
            params.emailAddress
          )}&v=${params.donorHash}${
            params?.campaignRequestId ? "&c=" + params.campaignRequestId : ""
          }" style="display:block;padding:16px 47px;margin:0 auto 0 0;background:#FBA94A;border-radius:100px;font-weight:600;line-height:20px;letter-spacing:0.2px;color:#ffffff;text-decoration:none;width: max-content;">Change</a>
                    </td></tr>
                    </table>
                    <br /><br />
                    Thank you so much for your continued support. We could not do this without you and your donation will make a massive difference to the families.
                    <br /><br />
                    <strong>CAUSE CHRISTMAS HAMPER TEAM</strong>
                    `,
        };
    }
    return "";
  },
  createDonorDetail(donorId, donors) {
    var rtnStr = "Not Allocated";
    const donor = donors ? donors.find((n) => n.GSI2PK === donorId) : {};
    if (donor?.PK) {
      rtnStr = `<strong>${donor.donorDetails.firstName} ${donor.donorDetails.lastName}</strong>`;
      if (donor.donorDetails.telephone) {
        rtnStr += ` - <a href="tel:${donor.donorDetails.telephone}">${donor.donorDetails.telephone}</a>`;
      }

      if (donor.donorDetails.company) {
        rtnStr += `<br />${donor.donorDetails.company}`;
      }
      if (donor.GSI3PK) {
        rtnStr += `<br /><a href="tel:${donor.GSI3PK}">${donor.GSI3PK}</a>`;
      }
      rtnStr += `<br /><a href="/donors/view/${donor.GSI2PK}" class="btn btn-info btn-fill btn-wd">Manage Donor</a>`;
    }
    return rtnStr;
  },
  createNominatorDetail(nominatorId, nominators) {
    var rtnStr = "";
    const nominator = nominators
      ? nominators.find((n) => n.GSI2PK === nominatorId)
      : {};
    if (nominator?.PK) {
      rtnStr = `<strong>${nominator.nominatorDetails.firstName} ${nominator.nominatorDetails.lastName}</strong>`;
      if (nominator.nominatorDetails.telephone) {
        rtnStr += ` - <a href="tel:${nominator.nominatorDetails.telephone}">${nominator.nominatorDetails.telephone}</a>`;
      }
      if (nominator.nominatorDetails.email) {
        rtnStr += `<br /><a href="tel:${nominator.nominatorDetails.email}">${nominator.nominatorDetails.email}</a>`;
      }
    }
    return rtnStr;
  },
  async generateAllocationEmails(
    donor,
    families,
    familiesMembers,
    standardTemplate,
    emailTemplate,
    includePDF,
    campaignRequestId
  ) {
    const getEmailTemplateParams = {
      appURL: process.env.APP_URL,
      websiteURL: process.env.WEBSITE_URL,
      emailAddress: donor.email,
      familyData: families,
      familyMemberData: familiesMembers,
      donorHash: donor.donorHash,
      campaignRequestId: campaignRequestId,
    };
    const emailTemplateParams = await Functions.getEmailTemplate(
      emailTemplate,
      getEmailTemplateParams
    );

    standardTemplate = standardTemplate.replace(
      "{{pageTitle}}",
      emailTemplateParams.pageTitle
    );
    standardTemplate = standardTemplate.replace(
      "{{pageContent}}",
      emailTemplateParams.pageContent
    );

    const rawEmailJsonParameters = {
      ToAddress: donor.email,
      htmlContent: standardTemplate,
      subject: emailTemplateParams.subject,
    };

    let hamperCount = 0;
    let csvContent = "";
    const pdfPages = [];
    for (const family of families) {
      hamperCount++;

      csvContent += '"Hamper ' + hamperCount + '"' + "\r\n";
      csvContent +=
        '"Hamper ID","Family Member","Age","Additional Information"' + "\r\n";
      const currentFamilyMembers = familiesMembers.filter(
        (fm) => fm.familyId == family.requestId
      );

      currentFamilyMembers.sort((a, b) =>
        b.age > a.age ? 1 : a.age > b.age ? -1 : 0
      );

      if (includePDF) {
        pdfPages.push({
          template: "labels",
          qrCode: family.reference,
          replaceStrings: {
            "###DONOR_NAME###": `${donor.firstName} ${donor.lastName}`,
            "###HAMPER_ID###": `${family.reference}`,
            "###FAMILY_DYNAMICS###": `${await Functions.generateFamilyDynamics(
              family,
              currentFamilyMembers,
              csvContent
            )}`,
          },
        });
      }

      // Seperate Familes with a blank line
      csvContent += "\r\n";
    }

    if (families.length >= 5) {
      rawEmailJsonParameters.csvAttachment = csvContent;
      rawEmailJsonParameters.csvAttachmentFilename =
        "your-allocation-families.csv";
    }

    if (includePDF) {
      var params = {
        FunctionName: "pdf-live-downloadPdf", // the lambda function we are going to invoke
        InvocationType: "RequestResponse",
        LogType: "Tail",
        Payload: `{ "pdfPages" : ${JSON.stringify(pdfPages)} }`,
      };

      const lambdaResult = await lambda.invoke(params).promise();
      const resultObject = JSON.parse(lambdaResult.Payload);
      console.log(resultObject);

      /* */
      rawEmailJsonParameters.pdfAttachment = resultObject;
      rawEmailJsonParameters.pdfAttachmentFilename = "family-hamper-labels.pdf";
    }

    return rawEmailJsonParameters;
  },
  async generateFamilyDynamics(hamper, members, csvContent = "") {
    let familyDynamics = [];
    for (const familyMember of members) {
      const familyWho =
        familyMember.who +
        (familyMember.whoOther ? " (" + familyMember.whoOther + ")" : "");

      csvContent +=
        `"${hamper.reference}","${familyWho}","${familyMember.age}${
          familyMember.age ? " " + familyMember.ageType : ""
        }","${
          familyMember.additionalInfo ? familyMember.additionalInfo : ""
        }"` + "\r\n";
      familyDynamics.push(
        ` ${familyWho} ${
          familyMember.age ? familyMember.age + " " + familyMember.ageType : ""
        }`
      );
    }
    return familyDynamics.join(",");
  },
  async generateConfirmedAllocationEmail(
    donor,
    families,
    familiesMembers,
    standardTemplate
  ) {
    const emailTemplate = {
      familyData: families,
      familyMemberData: familiesMembers,
    };
    const emailTemplateParams = await Functions.getEmailTemplate(
      emailTemplate,
      emailTemplate
    );

    standardTemplate = standardTemplate.replace(
      "{{pageTitle}}",
      emailTemplateParams.pageTitle
    );
    standardTemplate = standardTemplate.replace(
      "{{pageContent}}",
      emailTemplateParams.pageContent
    );

    const rawEmailJsonParameters = {
      ToAddress: donor.email,
      htmlContent: standardTemplate,
      subject: emailTemplateParams.subject,
    };

    let hamperCount = 0;
    let csvContent = "";
    const pdfPages = [];
    for (const family of families) {
      hamperCount++;

      csvContent += '"Hamper ' + hamperCount + '"' + "\r\n";
      csvContent +=
        '"Hamper ID","Family Member","Age","Additional Information"' + "\r\n";
      const currentFamilyMembers = familiesMembers.filter(
        (fm) => fm.familyId == family.requestId
      );

      currentFamilyMembers.sort((a, b) =>
        b.age > a.age ? 1 : a.age > b.age ? -1 : 0
      );

      // Seperate Familes with a blank line
      csvContent += "\r\n";

      pdfPages.push({
        template: "labels",
        qrCode: family.reference,
        replaceStrings: {
          "###DONOR_NAME###": `${donor.firstName} ${donor.lastName}`,
          "###HAMPER_ID###": `${family.reference}`,
          "###FAMILY_DYNAMICS###": `${await Functions.generateFamilyDynamics(
            family,
            currentFamilyMembers,
            csvContent
          )}`,
        },
      });
    }

    if (families.length >= 5) {
      rawEmailJsonParameters.csvAttachment = csvContent;
      rawEmailJsonParameters.csvAttachmentFilename =
        "your-allocation-families.csv";
    }

    var params = {
      FunctionName: "pdf-live-downloadPdf", // the lambda function we are going to invoke
      InvocationType: "RequestResponse",
      LogType: "Tail",
      Payload: `{ "pdfPages" : ${JSON.stringify(pdfPages)} }`,
    };

    const lambdaResult = await lambda.invoke(params).promise();
    const resultObject = JSON.parse(lambdaResult.Payload);
    console.log(resultObject);

    /* */
    rawEmailJsonParameters.pdfAttachment = resultObject;
    rawEmailJsonParameters.pdfAttachmentFilename = "family-hamper-labels.pdf";

    return rawEmailJsonParameters;
  },
  async doBatchImport(batchData, batchTableName, chunkSize = 25) {
    if (batchData && batchData.length) {
      console.log(
        "batches to import, total:",
        batchData.length,
        "Batches:",
        batchData.length / chunkSize
      );
      for (let i = 0; i < batchData.length; i += chunkSize) {
        const chunk = batchData.slice(i, i + chunkSize);

        console.log("Batch", i, "/", batchData.length);

        await Dynamo.batchWrite(chunk, batchTableName).catch(async (err) => {
          if (
            err.includes(
              "ProvisionedThroughputExceededException - Waiting 5 seconds"
            )
          ) {
            console.log("ProvisionedThroughputExceededException", Waiting);
            await this.timer(5000);
            await this.doBatchImport(batchData, batchTableName, chunkSize);
          } else {
            console.log("error in dynamo write", err);
            return Responses._400({ messages: err });
          }
        });
        // Have a 1 second break each time
        await this.timer(1000);
      }
      console.log("Batch Import Fin.");
    }
    return false;
  },
};

module.exports = Functions;
