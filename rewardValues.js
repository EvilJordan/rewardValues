require('dotenv').config();
const fs = require('fs');
const fetch = require('node-fetch');
const ADDRESS = process.env.ADDRESS;
const ETHERSCANAPIKEY = process.env.ETHERSCANAPIKEY;
const OUTPUTFILE = './transactions.csv';
const TRANSACTIONCACHEFILE = './transactionCache.json';
const BACKOFFSECONDS = 5;
const WAITSECONDS = 30;
const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
});
var startDate, endDate;

processArguments = async () => {
    if (process.argv[2]) { // startDate
        if((/^[0-9]{2}-[0-9]{2}-[0-9]{4}$/.test(process.argv[2])) && new Date(process.argv[2]).toString() !== 'Invalid Date') {
            startDate = process.argv[2];
        } else {
            console.log('Malformed startDate');
            return false;
        }
    }
    if (process.argv[3]) { // endDate
        if((/^[0-9]{2}-[0-9]{2}-[0-9]{4}$/.test(process.argv[2])) && new Date(process.argv[3]).toString() !== 'Invalid Date') {
            endDate = process.argv[3];
        } else {
            console.log('Malformed endDate');
            return false;
        }
    }
    return true;
}

wait = (seconds) => {
    const waitTill = new Date(new Date().getTime() + seconds * 1000);
    while (waitTill > new Date()) {};
}

getTXs = async (transactions, page, action) => {
    let params = '&startblock=0&endblock=99999999';
    if (action !== 'txlist') {
        params = '&blocktype=blocks';
    }
    const request = await fetch('https://api.etherscan.io/api?module=account&action=' + action + '&address=' + ADDRESS + params + '&page=' + page + '&offset=1000&sort=asc&apikey=' + ETHERSCANAPIKEY, {
        method: 'GET'
    });
    if (request.status !== 200) {
        return;
    }
    const response = await request.json();
    if (response['message'] && response['message'] === 'OK') {
        if (response.status !== '1') { // we're done
            return transactions;
        } else { // process transactions
            response.result.forEach(function (tx) {
                let value = 'value';
                if (action !== 'txlist') {
                    value = 'blockReward';
                } else {
                    if (tx['to'].toLowerCase() !== ADDRESS.toLowerCase()) { // we only want received transactions
                        return;
                    }
                }
                let date = new Date(tx.timeStamp * 1000);
                date.setDate(date.getDate() + 1); // add 1 day to get closing price from coingecko
                const day = (date.getDate().toString().length > 1 ? date.getDate() : 0 + date.getDate().toString());
                const month = (date.getMonth() + 1).toString().length > 1 ? (date.getMonth() + 1) : 0 + (date.getMonth() + 1).toString();
                const txClosingPriceDate = day + '-' + month + '-' + date.getFullYear(); // coingecko date is dd-mm-yyyy
                if (!transactions[txClosingPriceDate]) {
                    transactions[txClosingPriceDate] = { transactions: [] };
                }
                transactions[txClosingPriceDate].transactions.push({ timeStamp: tx.timeStamp, hash: tx.hash ? tx.hash : null, blockNumber: tx.blockNumber, ethValue: (tx[value] / 1000000000000000000) }); // convert from gwei
            });
            page += 1;
            transactions = await getTXs(transactions, page, action);
        }
    } else if (response['message'] && response['message'] === 'NOTOK') {
        console.log('backing off for', BACKOFFSECONDS, 'seconds...');
        wait(BACKOFFSECONDS);
        transactions = await getTXs(transactions, page, action);
    }
    return transactions;
}

getPrices = async (transactions, transactionCache) => {
    const numDates = Object.keys(transactions).length;
    let i;
    for (i = 0; i < numDates; i++) {
        const thisDate = Object.keys(transactions)[i];
        // need to check if thisDate > today, and if so, just return 0 since we don't have a closing price yet
        const dateParts = thisDate.split('-');
        const thisDateTime = new Date(dateParts[1] + '-' + dateParts[0] + '-' + dateParts[2]).getTime();
        const now = new Date().getTime();
        if (thisDateTime < now) {
            if (transactionCache[thisDate] && transactionCache[thisDate].closingPrice && transactionCache[thisDate].closingPrice !== 0) { // if we already have this data in our "cache," don't pull it again
                transactions[thisDate].closingPrice = transactionCache[thisDate].closingPrice;
                continue;
            }
            const request = await fetch('https://api.coingecko.com/api/v3/coins/ethereum/history?date=' + thisDate + '&localization=false', {
                method: 'GET'
            });
            if (request.status !== 200) {
                console.log('coingecko error:', request);
                return false;
            }
            const response = await request.json();
            transactions[thisDate].closingPrice = response.market_data.current_price.usd;
            if (i > 0 && i % 10 === 0) { // coingecko limited to 10 calls per minute
                console.log(i, '/', numDates);
                console.log('waiting for', WAITSECONDS, 'seconds...');
                wait(WAITSECONDS);
            }
        } else {
            transactions[thisDate].closingPrice = 0;
        }
    }
    return true;
}

isTransactionWithinDateRange = (timeStamp, startDate, endDate) => {
    let startDateTime, endDateTime;
    if (startDate) {
        startDateTime = new Date(startDate).getTime();
    }
    if (endDate) {
        endDateTime = new Date(endDate).getTime();
    }
    let valid = true;
    if (startDate && startDateTime && (timeStamp * 1000) <= startDateTime) {
        valid = false;
    }
    if (endDate && endDateTime && (timeStamp * 1000) >= endDateTime) {
        valid = false;
    }
    return valid;
}

getUSDValue = async (transactions, startDate, endDate) => {
    let totalUSD = 0;
    let totalETH = 0;
    Object.keys(transactions).forEach(function (thisDate) {
        if (!(/^[0-9]{2}-[0-9]{2}-[0-9]{4}$/).test(thisDate)) { // only process dates and transactions
            return;
        }
        transactions[thisDate]['transactions'].forEach(function (tx) {
            if (isTransactionWithinDateRange(tx.timeStamp, startDate, endDate)) {
                tx.usdValue = transactions[thisDate].closingPrice * tx.ethValue;
                totalUSD += tx.usdValue;
                totalETH += tx.ethValue;
            }
        });
    });
    transactions.totalUSD = totalUSD;
    transactions.totalETH = totalETH;
    return transactions;
}

writeData = (transactions, startDate, endDate) => {
    fs.writeFileSync(TRANSACTIONCACHEFILE, JSON.stringify(transactions, null, 4)); // write out our "cache"
    fs.writeFileSync(OUTPUTFILE, 'Date,USD Closing Price,USD Value,ETH,Block Number,Transaction Hash\n');
    let outputData = {};
    Object.keys(transactions).forEach(function (thisDate) {
        if (!(/^[0-9]{2}-[0-9]{2}-[0-9]{4}$/).test(thisDate)) { // only process dates and transactions
            return;
        }
        transactions[thisDate]['transactions'].forEach(function (tx) {
            const dateParts = thisDate.split('-');
            const thisRationalDate = dateParts[1] + '-' + dateParts[0] + '-' + dateParts[2]; // change the date to mm-dd-yyyy
            if (isTransactionWithinDateRange(tx.timeStamp, startDate, endDate)) {
                outputData[tx.timeStamp] = [thisRationalDate, transactions[thisDate].closingPrice, tx.usdValue, tx.ethValue, tx.blockNumber, tx.hash];
            }
        });
    });
    if (outputData) {
        outputDataSorted = Object.keys(outputData).sort().reduce((obj, key) => { obj[key] = outputData[key]; return obj; }, {}); // sort by transaction timestamp ascending
        Object.keys(outputDataSorted).forEach(function (tx) {
            fs.appendFileSync(OUTPUTFILE, outputDataSorted[tx].join(',') + '\n');
        });
    }
}

go = async () => {
    if(!await processArguments()) {
        return;
    }
    let transactions = {};
    transactionCache = JSON.parse(fs.readFileSync(TRANSACTIONCACHEFILE));
    await getTXs(transactions, 1, 'txlist');
    await getTXs(transactions, 1, 'getminedblocks');
    const getPricesResult = await getPrices(transactions, transactionCache);
    if (!getPricesResult) { // there was a coingecko error
        return;
    }
    await getUSDValue(transactions, startDate, endDate);
    writeData(transactions, startDate, endDate); // write out our data
    console.log(transactions.totalETH); // total ETH earned
    console.log('\x1b[32m' + formatter.format(transactions.totalUSD) + '\x1b[0m'); // total USD value at time of earnings
}

go();