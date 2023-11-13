const arr = 'jamie.is.the'.split('.');
console.log(arr);
console.log('start');
const obj = {
  jamie: {
    is: {
      the: {
        best: 'YAAS'
      }
    }
  }
};

const checkValue = (keys, obj) => {
  let returnValue = "";
  let checkObj = {...obj};
  let i = 0;
  for (const key of keys) {
    i++;
    console.log(keys.length);
    if (checkObj[key]) {
      checkObj = checkObj[key];
      returnValue = checkObj;
    } else {
      console.log(checkObj);
      returnValue = null;
    }
  }
  console.log('returnValue', returnValue);
  return returnValue
};

const test2 = checkValue(arr, obj);
console.log(test2);
/*
let select = (arr, obj) => arr.reduce((r, e) => Object.assign(r, obj[e] ? {[e]: obj[e]} : null), {})

const test = select(arr, obj);
console.log(test);
console.log(arr);
console.log(obj);
*/