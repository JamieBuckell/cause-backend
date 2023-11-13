const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

const moment = require("moment-timezone");

var uuid = require('uuid');

exports.handler = async (event, context, cb) => {
    try {
        const timezone = process.env.TIMEZONE;
        const dateFormat = process.env.DATE_FORMAT;
        const timeStamp = moment((new Date()).getTime()).tz(timezone).format(dateFormat);
        const tableName = process.env.ORGANISATIONS_TABLE;
        const nomTableName = process.env.NOMINATORS_TABLE;

        const allOrgs = [
            ["ED01","ALPHONSUS' (ST) CATHOLIC PRIMARY","Jackie","McGee","mcgee.j@npcat.org.uk","School"],
            ["ED02","BRAMBLES PRIMARY ACADEMY","Tracy","Gill","brtgill@tved.org.uk","School"],
            ["ED03","BRECKON HILL PRIMARY SCHOOL","Carol","Price","carol_price@breckonhillprimary.co.uk","School"],
            ["ED04","CORPUS CHRISTI RC PRIMARY","Andrea","Hurt","hurt.a@corpus.npcat.org.uk","School"],
            ["ED05","DORMANSTOWN PRIMARY ACADEMY","Sharron","Sherwood","sharron.sherwood@tved.org.uk","School"],
            ["ED06","EASTERSIDE ACADEMY","Delyth","Linacre","d.linacre@eastersideacademy.co.uk","School"],
            ["ED07","GABRIEL'S (ST) PRIMARY","Vicky","Cook","cook.v@stgabriels.npcat.org.uk","School"],
            ["ED08","GERARD'S (ST) PRIMARY","Karen","Parkinson","parkinson.k@stgerards.npcat.org.uk","School"],
            ["ED09","GREENGATES PRIMARY","Carol","Barwell","Carol.barwell@greengatesprimary.co.uk","School"],
            ["ED10","GREGORY'S (ST) PRIMARY STOCKTON","Gina","Keen","wellbeing@stgregorys.bhcet.org","School"],
            ["ED11","HAREWOOD PRIMARY THORNABY","Louise","Anderson","louise.anderson@harewoodprimary.org.uk","School"],
            ["ED12","HEMLINGTON HALL ACADEMY","Jill","Harrison","jharrison@hemlingtonhallacademy.co.uk","School"],
            ["ED13","HIGH CLARENCE PRIMARY","Sue","Wastell","sue.wastell@sbcschools.org.uk","School"],
            ["ED14","JOSEPH'S (ST) PRIMARY","Jill","Manders","manders.j@stjosephscp.npcat.org.uk","School"],
            ["ED15","MARGARET (ST) CLITHEROW","Becky","Gaynon-Johnson","gaynon-johnson.r@smc.npcat.org.uk","School"],
            ["ED16","MARY'S (ST) PRIMARY","Lyndsey","Jones","jones.l@stmarys.npcat.org.uk","School"],
            ["ED17","NEWPORT PRIMARY","Denise","Batty","denise.batty@newportprimary.org.uk","School"],
            ["ED18","NORTH ORMESBY ACADEMY","Cassie","Williams","cwilliams@northormesbyacademy.org","School"],
            ["ED19","SACRED HEART PRIMARY","Vicky","White","white.v@sacredheartcp.npcat.org.uk","School"],
            ["ED20","SOUTH BANK PRIMARY","Tammy","Cooper","safeguarding@southbankprimary.co.uk","School"],
            ["ED21","THOMAS MORE (ST)","Holly","Johnson","johnson.h@stm.npcat.org.uk","School"],
            ["ED22","THORNTREE ACADEMY","Kath","Cottle","trkath.cottle@thorntreeacademy.org.uk","School"],
            ["ED23","TILERY PRIMARY","Christine","Pratt","tpcpratt@tileryprimary.org.uk","School"],
            ["HC01","HARTLEPOOL SAS TEAM 1","Louise","Webster","louise.webster@hartlepool.gov.uk","Local Authority"],
            ["HC02","HARTLEPOOL SAS TEAM 2","Julie","Kadhim","julie.kadhim@hartlepool.gov.uk","Local Authority"],
            ["HC03","HARTLEPOOL SAS TEAM 3","Angela","Parker","angela.parker@hartlepool.gov.uk","Local Authority"],
            ["HC04","HARTLEPOOL SAS TEAM 4","Carrie","Brown","carrie.brown@hartlepool.gov.uk","Local Authority"],
            ["HC05","HARTLEPOOL SAS TEAM 5","Kate","Proctor","kate.proctor@hartlepool.gov.uk","Local Authority"],
            ["HC06","HARTLEPOOL SAS TEAM 6","Michelle","Howard","michelle.howard@hartlepool.gov.uk","Local Authority"],
            ["HC07","HARTLEPOOL DISABILITY TEAM","Katharine","Brown","katharine.brown@hartlepool.gov.uk","Local Authority"],
            ["HC08","HARTLEPOOL FRONTLINE TEAM","Jessica","Gibson","jessica.gibson@hartlepool.gov.uk","Local Authority"],
            ["HC09","HARTLEPOOL THROUGH CARE TEAM","Lisa","Cushlow","lisa.cushlow@hartlepool.gov.uk","Local Authority"],
            ["HC10","HARTLEPOOL YOUTH JUSTICE SERVICES","Vicki","Hull","vicki.hull@hartlepool.gov.uk","Local Authority"],
            ["MC01","MIDDLESBROUGH SCP TEAM 1","Angela","Jobe","angela_jobe@middlesbrough.gov.uk","Local Authority"],
            ["MC02","MIDDLESBROUGH SCP TEAM 2","Christeina","Webb","christeina_webb@middlesbrough.gov.uk","Local Authority"],
            ["MC03","MIDDLESBROUGH SCP TEAM 3","Sarah","Taylor","sarah_taylor@middlesbrough.gov.uk","Local Authority"],
            ["MC04","MIDDLESBROUGH SCP TEAM 4","Angela","Hill","Angela_Hill@middlesbrough.gov.uk","Local Authority"],
            ["MC05","MIDDLESBROUGH SCP TEAM 5","Robert","Jayne","robert_jayne@middlesbrough.gov.uk","Local Authority"],
            ["MC06","MIDDLESBROUGH SCP TEAM 6","","","No team manager at the moment","Local Authority"],
            ["MC07","MIDDLESBROUGH SCP TEAM 7","Amy","Hamilton","amy_hamilton@middlesbrough.gov.uk","Local Authority"],
            ["MC08","MIDDLESBROUGH SCP TEAM 8","Mandy","Barker","mandy_barker@middlesbrough.gov.uk","Local Authority"],
            ["MC09","MIDDLESBROUGH SCP TEAM 9","Emma","Barker-Rayner","emma_barker-rayner@middlesbrough.gov.uk","Local Authority"],
            ["MC10","MIDDLESBROUGH SW ACADEMY","Lois","Mallon","lois_mallon@middesbrough.gov.uk","Local Authority"],
            ["MC11","CHILDREN LOOKED AFTER TEAM 1","Natasha","Gray","natasha_gray@middlesbrough.gov.uk","Local Authority"],
            ["MC12","CHILDREN LOOKED AFTER TEAM 2","Emma","Atkinson","emma_atkinson@middlesbrough.gov.uk","Local Authority"],
            ["MC13","CHILDREN LOOKED AFTER TEAM 3","Sharon","Hetherington","sharon_hetherington@middlesbrough.gov.uk","Local Authority"],
            ["MC14","MIDDLESBROUGH FRONTLINE","Lillian","Gray","Lilian_gray@middlesbrough.gov.uk","Local Authority"],
            ["MC15","THORNTREE COMMUNITY HUB","Linda","Kime","linda_kime@middlesbrough.gov.uk","Local Authority"],
            ["MC16","STRONGER FAMILIES (WMCC)","Liza","Mulligan","liza_mulligan@middlesbrough.gov.uk","Local Authority"],
            ["MC17","CHILDREN WITH DISABILITIES","Graham","Davies","graham_davies@middlesbrough.gov.uk","Local Authority"],
            ["MC18","NORTH ORMESBY COMMUNITY HUB","Cheryl","Dixon","cheryl_dixon@outlook.com","Local Authority"],
            ["MC19","PATHWAYS","Gemma","McLaren","gemma_mclaren@middlesbrough.gov.uk","Local Authority"],
            ["RC01","REDCAR & CLEVELAND CHILDREN SERVICES TEAM","Charlotte","Williams","charlotte.williams@redcar-cleveland.gov.uk","Local Authority"],
            ["RC02","EAST CLEVELAND FAMILY HUB","Sarah","Mark","sarah.mark@redcar-cleveland.gov.uk","Local Authority"],
            ["RC03","GREATER ESTON FAMILY HUB","Caitlin","Adams","caitlin.adams@redcar-cleveland.gov.uk","Local Authority"],
            ["SC01","STOCKTON SOCIAL WORK SOUTH TEAM 1","Clive","Potts","clive.potts@stockton.gov.uk","Local Authority"],
            ["SC02","STOCKTON SOCIAL WORK SOUTH TEAM 2","Emma","Hare","emma.hare@stockton.gov.uk","Local Authority"],
            ["SC03","STOCKTON SOCIAL WORK SOUTH TEAM 3","Charlotte","Potts","charlotte.potts@stockton.gov.uk","Local Authority"],
            ["SC04","STOCKTON SOCIAL WORK SOUTH TEAM 4","Julie","Allinson","julie.allinson@stockton.gov.uk","Local Authority"],
            ["SC05","TRANSITIONS TEAM","Maureen","Dodsworth","maureen dodsworth@middlesbrough.gov.uk","Local Authority"],
            ["SC05","STOCKTON SOCIAL WORK NORTH TEAM 1","Lisa","Pope","lisa.pope@stockton.gov.uk","Local Authority"],
            ["SC06","STOCKTON SOCIAL WORK NORTH TEAM 2","Louise","Nixon","louise.nixon@stockton.gov.uk","Local Authority"],
            ["SC07","STOCKTON SOCIAL WORK NORTH TEAM 3","Glenn","Langley","glenn.langley@stockton.gov.uk","Local Authority"],
            ["SC08","STOCKTON SOCIAL WORK NORTH TEAM 4","Jennie","Nugent","jennifer.nugent@stockton.gov.uk","Local Authority"],
            ["SC09","STOCKTON FAMILY SOLUTIONS TEAM","Andrew","Wilson","andrew.wilson@stockton.gov.uk","Local Authority"],
            ["CH01","A WAY OUT","Victoria","Rogers","victoria.rogers@awayout.co.uk","Charity"],
            ["CH02","BUNGALOW PROJECT","Ellen","Brannigan","ellenb1977@outlook.com","Charity"],
            ["CH03","HARBOUR HARTLEPOOL","Danielle","Chadwick","daniellechadwick@myharbour.org.uk","Charity"],
            ["CH04","HARBOUR STOCKTON","Lauren","Vokes","laurenvokes@myharbour.org.uk","Charity"],
            ["CH05","HESTIA","Janet","Mohan","Janet.mohan@northstarhg.co.uk","Charity"],
            ["CH06","HOMESTART - TEESSIDE","Michelle","Hardy","michelle.hardy@homestart-teesside.org.uk","Charity"],
            ["CH07","LINK REDCAR","Rebecca","Learman","rebecca@linkct.org.uk","Charity"],
            ["CH09","MY SISTERS PLACE","Lisa","McGovern","lisa.mcgovern@mysistersplace.co.uk","Charity"],
            ["CH10","NACRO","Susan","Flanagan","susan.flanagan@nacro.org.uk","Charity"],
            ["CH11","NORTH STAR HOUSING","Lisa","Morgan","lisa.morgan@northstarhg.co.uk","Charity"],
            ["CH12","THIRTEEN","Nicola","Hamilton","nicola.hamilton@thirteengroup.co.uk","Charity"],
            ["CH13","TEESSIDE FAMILY FOUNDATION","Jill","Clayton","jill@theteessidefamily.com","Charity"],
            ["CH14","TRINITY CENTRE","Lee-Anne","Southon","lee-anne.southon@trinitycentre.org","Charity"]
        ];

        for (var i = 0; i < allOrgs.length; i++) {
            console.log(allOrgs[i]);
            const organisationId = uuid.v4();
            const orgData = allOrgs[i];
            const orgRef = orgData[0];
            const orgName = orgData[1];
            const leadFirstName = orgData[2];
            const leadLastName = orgData[3];
            const leadEmailAddress = orgData[4];
            const orgType = orgData[5].toString().toLocaleLowerCase().replace(' ', '-');
            const fullName = `${leadFirstName} ${leadLastName}`;

            const newOrgData = {
                "requestId": organisationId,
                "hashSalt": Hashing.generateSalt(6),
                "hashedData": Hashing.generateSalt(14) + '-' + Hashing.generateSalt(14),
                "name": orgName,
                "type": orgType,
                "reference": orgRef,
                "leadContactName": "",
                "leadContactNumber": "",
                "leadContactEmail": "",
                "secondaryContactName": "",
                "secondaryContactNumber": "",
                "secondaryContactEmail": "",
                "dateSubmitted": timeStamp,
                "status": "",
            }

            await Dynamo.write(newOrgData, tableName).catch(err => {
                console.log('error in dynamo write', err);
                return Responses._400({ messages: err });
            });


            const leadUserId = uuid.v4();

            // use replace for extra layer of security
            const userInitials = Functions.getUsersUniqueReference(fullName);
            let userReference = userInitials;

            const queryData = {
                'IndexName': 'nominatorOrganisationRequest',
                'KeyConditionExpression': 'emailAddress = :emailAddress AND organisationId = :organisationId',
                'ExpressionAttributeValues': {
                    ':emailAddress': leadEmailAddress,
                    ':organisationId': organisationId
                }
            };
            const existingUser = await Dynamo.query(queryData, nomTableName).catch(err => {
                console.log('error in dynamo query', err);
                return Responses._400({ messages: err });
            });

            if (existingUser.length) {
                return Responses._400({ messages: { "duplicate": "User already exists" }});
            }

            const referenceQueryData = {
                'IndexName': 'referenceSearch',
                'KeyConditionExpression': 'userInitials = :userInitials AND organisationId = :organisationId',
                'ExpressionAttributeValues': {
                    ':userInitials': userReference,
                    ':organisationId': organisationId
                }
            };
            const existingReference = await Dynamo.query(referenceQueryData, nomTableName).catch(err => {
                console.log('error in dynamo query', err);
                return Responses._400({ messages: err });
            });
            if (existingReference.length > 0) {
                const userCount = existingReference.length + 1;
                userReference = `${userReference}${Functions.numToSSColumn(userCount)}`;
            }

            const requestData = {
                "requestId": leadUserId,
                "cognitoId": "",
                "firstName": leadFirstName,
                "lastName": leadLastName,
                "emailAddress": leadEmailAddress,
                "telephoneNumber": "",
                "organisationId": organisationId,
                "userInitials": userInitials,
                "userReference": userReference,
                "dateSubmitted": timeStamp,
                "emailSent": false,
                "status": "Approved",
                "isAdmin": 'true',
            }
            
            const newRequest = await Dynamo.write(requestData, nomTableName).catch(err => {
                console.log('error in dynamo write', err);
                return Responses._400({ messages: err });
            });

            if (!newRequest) {
                return Responses._400({ message: 'Failed to write db by ID' });
            }
        }

        return Responses._200({ messages: { 'success': 'Import successful' }});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};