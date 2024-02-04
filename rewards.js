require('dotenv').config();
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { ethers } = require('ethers');
const cliProgress = require('cli-progress');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const argv = yargs(hideBin(process.argv))
	.string(['startDate', 'endDate'])
	.number(['startBlock', 'endBlock'])
	.alias('s', 'startDate')
	.alias('e', 'endDate')
	.alias('b', 'startBlock')
	.alias('c', 'endBlock')
	.alias('w', 'wipeWithdrawals')
	.alias('t', 'wipeTransactions')
	.alias('x', 'extractPrices')
	.wrap(null)
	.describe('startDate', 'start date in mm-dd-yyyy')
	.describe('endDate', 'end date in mm-dd-yyyy - omitting endDate when including startDate will set endDate to "now"')
	.describe('startBlock', 'start block number - omitting will set to the latest available block number since the last time successfully ran, or 0 if never run before')
	.describe('endBlock', 'end block number - omitting will set to the latest mainnet block')
	.describe('wipeWithdrawals', 'wipe all withdrawal data from the transaction cache and immediately write out, then exit')
	.describe('wipeTransactions', 'wipe all transaction data from the transaction cache and immediately write out, then exit')
	.describe('extractPrices', 'extract prices by block/date into object and write to disk')
	.argv;
const ADDRESS = process.env.ADDRESS;
const ETHERSCANAPIKEY = process.env.ETHERSCANAPIKEY;
const COINGECKOAPIKEY = process.env.COINGECKOAPIKEY;
const OUTPUTFILE = './transactions.csv';
const TRANSACTIONCACHEFILE = './.transactionCache.json';
const PRICEFILE = './.prices.json';
const BACKOFFSECONDS = 5;
const COINGECKOWAITSECONDS = 60;
const COINGECKOREQUESTSIZE = 30;
const formatter = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD'
});
const NONTAXABLEADDRESSES = [ // change from using uniswap routers
	'0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', // uniswap router 1
	'0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b' // uniswap router 2
];
let transactions = {};
let prices = {};
let startingTransactionBlockNumber = 0;
let startingWithdrawalsBlockNumber = 0;
let endingBlockNumber = 9999999999;
let startDate, endDate, progressBar;

/**
 * Process command line arguments and check for validity
 * @returns {boolean}
 */
const processArguments = async () => {
	if (argv.startDate) { // startDate
		if ((/^[0-9]{2}-[0-9]{2}-[0-9]{4}$/.test(argv.startDate)) && new Date(argv.startDate).toString() !== 'Invalid Date') {
			startDate = argv.startDate;
		} else {
			console.log('Malformed startDate');
			return false;
		}
	}
	if (argv.endDate) { // endDate
		if ((/^[0-9]{2}-[0-9]{2}-[0-9]{4}$/.test(argv.startDate)) && new Date(argv.endDate).toString() !== 'Invalid Date') {
			endDate = argv.endDate;
		} else {
			console.log('Malformed endDate');
			return false;
		}
	}
	if (argv.startBlock && argv.startBlock < 17034893) { // shapella activation block
		console.log('startBlock is too early');
		return false;
	}
	return true;
}

/**
 * Pause execution for a number of seconds
 * @param {Number} seconds - number of second to pause
 * @returns {void}
 */
const wait = (seconds) => {
	const waitTill = new Date(new Date().getTime() + seconds * 1000);
	while (waitTill > new Date()) {
		// wait
	}
}

/**
 * get most recently retrieved block number +1 from transaction cache
 * @param {string} blockType - withdrawals or transactions
 * @returns {Promise<Number>}
 */
const getStartingBlockNumber = async (blockType) => {
	let startingBlockNumber = 0;
	Object.keys(transactions).forEach(function (thisBlock) {
		if (transactions[thisBlock][blockType]) {
			if (startingBlockNumber < thisBlock) {
				startingBlockNumber = thisBlock;
			}
		}
	});
	return Number(startingBlockNumber + 1);
}

/**
 * check if a withdrawal already exists in our transaction object
 * @param {Object} transactions - transactions object
 * @param {string} blockNumber - tx blockNumber
 * @param {string} withdrawalIndex - tx withdrawalIndex
 * @returns {Promise<Boolean>}
 */
const isDuplicateWithdrawal = async (transactions, blockNumber, withdrawalIndex) => {
	let i;
	for (i = 0; i < transactions[blockNumber].withdrawals.length; i++) {
		const withdrawalData = transactions[blockNumber].withdrawals[i];
		if (Number(withdrawalData.withdrawalIndex) === Number(withdrawalIndex)) {
			return true;
		}
	}
	return false;
}

/**
 * get beacon chain withdrawals
 * @param {Object} transactions - transactions object
 * @param {Number} page - page number
 * @returns {Object} transactions
 */
const getWithdrawals = async (transactions, page) => {
	let params = '&startblock=' + startingWithdrawalsBlockNumber + '&endblock=' + endingBlockNumber;
	const URL = 'https://api.etherscan.io/api?module=account&action=txsBeaconWithdrawal&address=' + ADDRESS + params + '&page=' + page + '&offset=1000&sort=asc&apikey=' + ETHERSCANAPIKEY;
	const request = await fetch(URL, {
		method: 'GET'
	});
	if (request.status !== 200) {
		return;
	}
	const response = await request.json();
	if (response.message && response.message === 'OK') {
		if (response.status !== '1') { // we're done
			return transactions;
		} else { // process withdrawals
			let i;
			for (i = 0; i < response.result.length; i++) {
				const tx = response.result[i];

				const date = new Date(tx.timestamp * 1000);
				const day = (date.getUTCDate().toString().length > 1 ? date.getUTCDate() : 0 + date.getUTCDate().toString());
				const month = (date.getUTCMonth() + 1).toString().length > 1 ? (date.getUTCMonth() + 1) : 0 + (date.getUTCMonth() + 1).toString();
				const txClosingPriceDate = day + '-' + month + '-' + date.getUTCFullYear(); // coingecko date is dd-mm-yyyy
				
				if (!transactions[tx.blockNumber]) {
					transactions[tx.blockNumber] = { date: txClosingPriceDate, withdrawals: [] };
				}
				if (!transactions[tx.blockNumber].withdrawals) {
					transactions[tx.blockNumber].withdrawals = [];
				}

				const ethValue = Number(ethers.formatUnits(tx.amount, 'gwei'));
				const isDuplicate = await isDuplicateWithdrawal(transactions, tx.blockNumber, tx.withdrawalIndex);
				if (!isDuplicate) {
					transactions[tx.blockNumber].withdrawals.push({ timeStamp: Number(tx.timestamp), withdrawalIndex: Number(tx.withdrawalIndex), ethValue });
				}
			}
			page += 1;
			transactions = await getWithdrawals(transactions, page);
		}
	} else if (response.message && response.message === 'NOTOK') {
		// ('backing off Etherscan for', BACKOFFSECONDS, 'seconds...');
		wait(BACKOFFSECONDS);
		transactions = await getWithdrawals(transactions, page);
	}
	return transactions;
}

/**
 * check if a transaction already exists in our transaction object
 * @param {Object} transactions - transactions object
 * @param {string} [hash] - tx hash
 * @param {string} blockNumber - tx blockNumber
 * @param {Number} ethValue - ethereum amount
 * @param {string} timeStamp - tx timeStamp
 * @returns {Promise<Boolean>}
 */
const isDuplicateTx = async (transactions, hash, blockNumber, ethValue, timeStamp) => {
	let i;
	for (i = 0; i < transactions[blockNumber].transactions.length; i++) {
		const tx = transactions[blockNumber].transactions[i];
		if (tx.hash === hash && Number(tx.ethValue) === Number(ethValue) && Number(tx.timeStamp) === Number(timeStamp)) {
			return true;
		}
	}
	return false;
}

/**
 * get transactions from Etherscan
 * @param {Object} transactions - transactions object
 * @param {Number} page - page number
 * @param {string} action - Etherscan endpoint action
 * @returns {Object} transactions
 */
const getTXs = async (transactions, page, action) => {
	let params = '&startblock=' + startingTransactionBlockNumber + '&endblock=' + endingBlockNumber;
	if (action !== 'txlist') {
		params = '&blocktype=blocks';
	}
	const URL = 'https://api.etherscan.io/api?module=account&action=' + action + '&address=' + ADDRESS + params + '&page=' + page + '&offset=1000&sort=asc&apikey=' + ETHERSCANAPIKEY;
	const request = await fetch(URL, {
		method: 'GET'
	});
	if (request.status !== 200) {
		return;
	}
	const response = await request.json();
	if (response.message && response.message === 'OK') {
		if (response.status !== '1') { // we're done
			return transactions;
		} else { // process transactions
			let i;
			for (i = 0; i < response.result.length; i++) {
				const tx = response.result[i];
				let value = 'value';
				if (action !== 'txlist' && action !== 'txlistinternal') {
					value = 'blockReward';
				} else {
					if (tx.to.toLowerCase() !== ADDRESS.toLowerCase()) { // we only want received transactions
						continue;
					}
				}
				
				let taxable = true;
				if (tx.from && NONTAXABLEADDRESSES.indexOf(tx.from.toLowerCase()) != -1) {
					taxable = false;
				}

				const date = new Date(tx.timeStamp * 1000);
				const day = (date.getUTCDate().toString().length > 1 ? date.getUTCDate() : 0 + date.getUTCDate().toString());
				const month = (date.getUTCMonth() + 1).toString().length > 1 ? (date.getUTCMonth() + 1) : 0 + (date.getUTCMonth() + 1).toString();
				const txClosingPriceDate = day + '-' + month + '-' + date.getUTCFullYear(); // coingecko date is dd-mm-yyyy

				if (!transactions[tx.blockNumber]) {
					transactions[tx.blockNumber] = { date: txClosingPriceDate, transactions: [] };
				}
				if (!transactions[tx.blockNumber].transactions) {
					transactions[tx.blockNumber].transactions = [];
				}
				
				const ethValue = (tx[value] / 1000000000000000000);
				const isDuplicate = await isDuplicateTx(transactions, tx.hash ? tx.hash : null, tx.blockNumber, ethValue, tx.timeStamp);
				if (!isDuplicate) {
					transactions[tx.blockNumber].transactions.push({ timeStamp: Number(tx.timeStamp), hash: tx.hash ? tx.hash : null, taxable, ethValue }); // convert from gwei
				}
			}
			page += 1;
			transactions = await getTXs(transactions, page, action);
		}
	} else if (response.message && response.message === 'NOTOK') {
		// ('backing off Etherscan for', BACKOFFSECONDS, 'seconds...');
		wait(BACKOFFSECONDS);
		transactions = await getTXs(transactions, page, action);
	}
	return transactions;
}

/**
 * get daily ETH close price from CoinGecko
 * @param {Object} transactions - transactions object
 * @param {Object} transactionsCache - transactions cache object
 * @returns {Promise<Boolean>}
 */
const getPrices = async (transactions, transactionCache) => {
	let priceByDate = {};
	const numBlocks = Object.keys(transactions).length;
	progressBar = new cliProgress.SingleBar({ format: 'Retrieving closing day prices: [{bar}] {percentage}%' }, cliProgress.Presets.rect);
	progressBar.start(numBlocks, 0);
	let coingGeckoCalls = 0;
	let i;
	for (i = 0; i < numBlocks; i++) {
		const thisBlock = Object.keys(transactions)[i];
		const thisDate = transactions[thisBlock].date;
		if (priceByDate[thisDate]) { // check if we already have a price for this date from another block. If so, use it and continue to the next block
			transactions[thisBlock].closingPrice = priceByDate[thisDate];
			continue;
		}
		// need to check if thisDate > today, and if so, just return 0 since we don't have a closing price yet
		const dateParts = thisDate.split('-');
		const thisDateFormatted = new Date(dateParts[1] + '-' + dateParts[0] + '-' + dateParts[2]);
		thisDateFormatted.setDate(thisDateFormatted.getUTCDate());
		const thisDateTime = thisDateFormatted.getTime();
		const day = (thisDateFormatted.getUTCDate().toString().length > 1 ? thisDateFormatted.getUTCDate() : 0 + thisDateFormatted.getUTCDate().toString());
		const month = (thisDateFormatted.getUTCMonth() + 1).toString().length > 1 ? (thisDateFormatted.getUTCMonth() + 1) : 0 + (thisDateFormatted.getUTCMonth() + 1).toString();
		const thisDateAdjustedCoinGecko = day + '-' + month + '-' + thisDateFormatted.getUTCFullYear(); // coingecko date is dd-mm-yyyy

		const now = new Date().getTime();
		if (thisDateTime < now) {
			if (transactionCache[thisBlock] && transactionCache[thisBlock].closingPrice && transactionCache[thisBlock].closingPrice !== 0) { // if we already have this data in our "cache," don't pull it again
				transactions[thisBlock].closingPrice = transactionCache[thisBlock].closingPrice;
				continue;
			}
			if (Object.keys(prices).length > 0) { // use our secondary cache if available
				if (prices[thisDate]['blocks'].indexOf(thisBlock) != -1) {
					transactions[thisBlock].closingPrice = prices[thisDate].closingPrice;
					console.log('2 got price:', prices[thisDate].closingPrice);
					continue;
				}
			}
			const URL = 'https://api.coingecko.com/api/v3/coins/ethereum/history?date=' + thisDateAdjustedCoinGecko + '&localization=false';
			const request = await fetch(URL, {
				method: 'GET',
				headers: {
					'x-cg-demo-api-key' : COINGECKOAPIKEY 
				}
			});
			if (request.status !== 200) {
				console.log('coingecko error:', request);
				return false;
			}
			const response = await request.json();
			priceByDate[thisDate] = response.market_data.current_price.usd;
			transactions[thisBlock].closingPrice = response.market_data.current_price.usd;
			coingGeckoCalls++;
			if (coingGeckoCalls >= COINGECKOREQUESTSIZE) { // coingecko limited to 30 calls per minute with Demo API key
				console.log(' Hit', coingGeckoCalls, 'requests. Backing off for', COINGECKOWAITSECONDS, 'seconds...');
				wait(COINGECKOWAITSECONDS);
				coingGeckoCalls = 0;
			}
		} else {
			priceByDate[thisDate] = 0;
			transactions[thisBlock].closingPrice = 0;
		}
		progressBar.update(i + 1);
	}
	progressBar.stop();
	return true;
}

/**
 * determine if a given timeStamp is within the range of a given startDate and endDate
 * @param {Number} timeStamp - unix timestamp
 * @param {string} [startDate] - startDate
 * @param {string} [endDate] - endDate
 * @returns {Boolean}
 */
const isTransactionWithinDateRange = (timeStamp, startDate, endDate) => {
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

/**
 * get summation of fiat value and ETH for a given date range
 * @param {Object} transactions - transactions object
 * @param {string} startDate - startDate
 * @param {string} endDate - endDate
 * @returns {Object} totals
 */
const getSums = async (transactions, startDate, endDate) => {
	let totals = { totalUSD: 0, totalETH: 0 };
	Object.keys(transactions).forEach(function (thisBlock) {
		if (transactions[thisBlock].transactions) {
			transactions[thisBlock].transactions.forEach(function (tx) {
				if (tx.taxable) { // exclude uniswap change transactions because this data doesn't know about swaps for tax purposes
					if (isTransactionWithinDateRange(tx.timeStamp, startDate, endDate)) {
						tx.usdValue = transactions[thisBlock].closingPrice * tx.ethValue;
						totals.totalUSD += tx.usdValue;
						totals.totalETH += tx.ethValue;
					}
				}
			});
		}
		if (transactions[thisBlock].withdrawals) {
			transactions[thisBlock].withdrawals.forEach(function (withdrawal) {
				if (isTransactionWithinDateRange(withdrawal.timeStamp, startDate, endDate)) {
					withdrawal.usdValue = transactions[thisBlock].closingPrice * withdrawal.ethValue;
					totals.totalUSD += withdrawal.usdValue;
					totals.totalETH += withdrawal.ethValue;
				}
			});
		}
	});
	return totals;
}

/**
 * Write data to disk
 * @param {Object} transactions - transactions object
 * @param {string} [startDate] - startDate
 * @param {string} [endDate] - endDate
 * @returns {void}
 */
const writeData = (transactions, startDate, endDate) => {
	fs.writeFileSync(TRANSACTIONCACHEFILE, JSON.stringify(transactions, null, 4)); // write out our "cache"
	fs.writeFileSync(OUTPUTFILE, 'Date,Layer,USD Closing Price,USD Value,ETH,Block Number,Transaction Hash\n');
	let outputData = {};
	Object.keys(transactions).forEach(function (thisBlock) {
		if (transactions[thisBlock].transactions) {
			transactions[thisBlock].transactions.forEach(function (tx) {
				const dateParts = transactions[thisBlock].date.split('-');
				const thisRationalDate = dateParts[1] + '-' + dateParts[0] + '-' + dateParts[2]; // change the date to mm-dd-yyyy
				if (tx.taxable && isTransactionWithinDateRange(tx.timeStamp, startDate, endDate)) { // exclude non-taxable transactions because they're really change from uniswap and this data is PRE swapping
					while (outputData[tx.timeStamp]) {
						tx.timeStamp = tx.timeStamp + 1; // possible we have the same timestamp already, so add 1ms
					}
					outputData[tx.timeStamp] = [thisRationalDate, 'EL', transactions[thisBlock].closingPrice, tx.usdValue, tx.ethValue, thisBlock, tx.hash];
				}
			});
		}
		if (transactions[thisBlock].withdrawals) {
			transactions[thisBlock].withdrawals.forEach(function (withdrawal) {
				const dateParts = transactions[thisBlock].date.split('-');
				const thisRationalDate = dateParts[1] + '-' + dateParts[0] + '-' + dateParts[2]; // change the date to mm-dd-yyyy
				if (isTransactionWithinDateRange(withdrawal.timeStamp, startDate, endDate)) {
					while (outputData[withdrawal.timeStamp]) {
						withdrawal.timeStamp = withdrawal.timeStamp + 1; // possible we have the same timestamp already, so add 1ms
					}
					outputData[withdrawal.timeStamp] = [thisRationalDate, 'CL', transactions[thisBlock].closingPrice, withdrawal.usdValue, withdrawal.ethValue, thisBlock];
				}
			});
		}
	});
	if (outputData) {
		const outputDataSorted = Object.keys(outputData).sort().reduce((obj, key) => { obj[key] = outputData[key]; return obj; }, {}); // sort by transaction timestamp ascending
		Object.keys(outputDataSorted).forEach(function (tx) {
			fs.appendFileSync(OUTPUTFILE, outputDataSorted[tx].join(',') + '\n');
		});
	}
}

/**
 * Extract transaction cache price data and write to disk
 * @returns {void}
 */
const extractPrices = async () => {
	let prices = {};
	if (Object.keys(transactions).length > 0) {
		Object.keys(transactions).forEach(function (thisBlock) {
			const thisDate = transactions[thisBlock].date;
			if (!prices[thisDate]) {
				prices[thisDate] = { blocks: [], closingPrice: 0 };
			}
			prices[thisDate].blocks.push(thisBlock)
			if (prices[thisDate].closingPrice === 0) {
				prices[thisDate].closingPrice = transactions[thisBlock].closingPrice;
			}
		});
		fs.writeFileSync(PRICEFILE, JSON.stringify(prices, null, 4)); // write out our prices
	}
}

/**
 * Load existing prices from file
 * @returns {Object} prices
 */
const loadPrices = async () => {
	try {
		prices = JSON.parse(fs.readFileSync(PRICEFILE));
	} catch (err) {
		if (err.code !== 'ENOENT') {
			throw err;
		}
	}
	return prices;
}

/**
 * Main function
 * @returns {void}
 */
const go = async () => {
	if (!processArguments()) {
		return;
	}
	let transactionCache = {};
	try {
		transactionCache = JSON.parse(fs.readFileSync(TRANSACTIONCACHEFILE));
	} catch (err) {
		if (err.code !== 'ENOENT') {
			throw err;
		}
	}
	if (Object.keys(transactionCache).length > 0) {
		transactions = transactionCache;
	}
	if (argv.extractPrices) {
		prices = extractPrices();
		return;
	}
	prices = await loadPrices();
	if (argv.wipeWithdrawals) {
		Object.keys(transactions).forEach(function (thisBlock) {
			delete transactions[thisBlock].withdrawals;
		});
		writeData(transactions, startDate, endDate); // write out our data
		return;
	}
	if (argv.wipeTransactions) {
		Object.keys(transactions).forEach(function (thisBlock) {
			delete transactions[thisBlock].transactions;
		});
		writeData(transactions, startDate, endDate); // write out our data
		return;
	}
	startingWithdrawalsBlockNumber = await getStartingBlockNumber('withdrawals');
	startingTransactionBlockNumber = await getStartingBlockNumber('transactions');
	if (argv.endBlock) {
		endingBlockNumber = argv.endBlock;
	}
	if (argv.startBlock) {
		startingWithdrawalsBlockNumber = argv.startBlock;
	}
	// console.log('Starting Withdrawals Block Number is', startingWithdrawalsBlockNumber);
	// console.log('Starting Transaction Block Number is', startingTransactionBlockNumber);
	// console.log('Ending Block Number is', endingBlockNumber);
	
	progressBar = new cliProgress.SingleBar({ format: 'Retrieving transactions and withdrawals...: [{bar}]', barsize: 3 }, cliProgress.Presets.rect);
	progressBar.start(4, 0);
	await getTXs(transactions, 1, 'txlist');
	progressBar.increment();
	await getTXs(transactions, 1, 'txlistinternal');
	progressBar.increment();
	await getTXs(transactions, 1, 'getminedblocks');
	progressBar.increment();
	await getWithdrawals(transactions, 1);
	progressBar.increment();
	progressBar.stop();
	const getPricesResult = await getPrices(transactions, transactionCache);
	if (!getPricesResult) { // there was a coingecko error
		return;
	}
	const totals = await getSums(transactions, startDate, endDate);
	writeData(transactions, startDate, endDate); // write out our data
	console.log(totals.totalETH); // total ETH earned
	console.log('\x1b[32m' + formatter.format(totals.totalUSD) + '\x1b[0m'); // total USD value at time of earnings
}

go();