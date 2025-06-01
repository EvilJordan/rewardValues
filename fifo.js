const fs = require('fs');
const TRANSACTIONCACHEFILE = './.transactionCache.json';
const SELLFILE = './sells.csv';
let transactions = {};
let sells = [];
let sellTotal = 0;
let buyTotal = 0;

const isGreaterThanOneYear = (date1, date2) => {
	const oneYearInMilliseconds = 365 * 24 * 60 * 60 * 1000;
	const differenceInMilliseconds = Math.abs(date1.getTime() - date2.getTime());
	return differenceInMilliseconds > oneYearInMilliseconds;
}

const sell = async () => {
	while (sellTotal > 0 && transactions.length > 0) {
		for (const sellItem of sells) {
			Object.keys(sellItem).forEach((thisSellDate) => {
				let sellQuantity = sellItem[thisSellDate].quantity;
				console.log('Selling', sellQuantity, 'on', thisSellDate);
				while (sellQuantity > 0 && transactions.length > 0) {
					const buyTx = transactions[0];
					Object.keys(buyTx).forEach((thisDate) => {
						const sellDate = new Date(thisSellDate);
						const buyDate = new Date(thisDate);
						if (buyTx[thisDate].quantity <= sellQuantity) {
							sellItem[thisSellDate].costBasis += buyTx[thisDate].quantity * buyTx[thisDate].price;
							// convert thisSellDate and thisDate to dates for comparison
							// if thisSellDate > 1 year, then += to sellItem[thisSellDate].longTerm
							// else += shortTerm
							if (isGreaterThanOneYear(sellDate, buyDate)) {
								sellItem[thisSellDate].longTerm += buyTx[thisDate].quantity * buyTx[thisDate].price;
							} else {
								sellItem[thisSellDate].shortTerm += buyTx[thisDate].quantity * buyTx[thisDate].price;
							}
							sellQuantity -= buyTx[thisDate].quantity;
							buyTotal -= buyTx[thisDate].quantity;
							sellTotal -= buyTx[thisDate].quantity;
							transactions.shift(); // Remove the buyTx from inventory
							// console.log('exhausted', thisDate);
							// console.log('remaining', sellQuantity);
						} else {
							sellItem[thisSellDate].costBasis += sellQuantity * buyTx[thisDate].price;
							if (isGreaterThanOneYear(sellDate, buyDate)) {
								sellItem[thisSellDate].longTerm += sellQuantity * buyTx[thisDate].price;
							} else {
								sellItem[thisSellDate].shortTerm += sellQuantity * buyTx[thisDate].price;
							}
							buyTx[thisDate].quantity -= sellQuantity;
							buyTotal -= sellQuantity;
							sellTotal -= sellQuantity;
							sellQuantity = 0;
							// console.log('still has', buyTx[thisDate].quantity, 'left for', thisDate);
						}
					});
				}
				if (buyTotal <= 0) {
					throw new Error('Not enough ETH');
				}
			});
		}
	}
	if (sellTotal > 0) {
		throw new Error('Not enough ETH');
	}
	console.log('Remaining ETH', buyTotal);
	let sellData = [];
	sells.forEach((thisData, i) => {
		const key = Object.keys(thisData)[0];
		sellData.push({ date: key, quantity: sells[i][key].quantity, costBasis: sells[i][key].costBasis, shortTem: sells[i][key].shortTerm, longTerm: sells[i][key].longTerm });
	});
	console.table(sellData);
	return;
}

const getInventoryValueAndQuantity = async () => {
	let value = 0;
	let quantity = 0;
	for (const item of transactions) {
		Object.keys(item).forEach((thisDate) => {
			value += item[thisDate].quantity * item[thisDate].price;
			quantity += item[thisDate].quantity;
		});
	}
	console.log('Starting ETH:', quantity);
	return quantity;
}

const getSellQuantity = async () => {
	let total = 0;
	for (const item of sells) {
		Object.keys(item).forEach((thisDate) => {
			total += item[thisDate].quantity;
		});
	}
	console.log('Selling ETH:', total);
	return total;
}

const sortObjectKeys = (obj) => {
	const orderedKeys = Object.keys(obj).sort();
	const sortedObj = {};
	orderedKeys.forEach(key => {
		sortedObj[key] = obj[key];
	});
	return sortedObj;
}

const go = async () => {
	try {
		transactions = JSON.parse(fs.readFileSync(TRANSACTIONCACHEFILE));
	} catch (err) {
		if (err.code !== 'ENOENT') {
			throw err;
		}
	}

	// transform transactions into grouped-by-day object
	let txData = {};
	Object.keys(transactions).forEach((thisBlock) => {
		const dateParts = transactions[thisBlock].date.split('-');
		const thisRationalDate = dateParts[2] + '-' + dateParts[1] + '-' + dateParts[0]; // change the date to yyyy-mm-dd
		const closingPrice = transactions[thisBlock].closingPrice;
		if (transactions[thisBlock].transactions) {
			transactions[thisBlock].transactions.forEach((tx) => {
				if (tx.taxable) {
					if (!txData[thisRationalDate]) {
						txData[thisRationalDate] = {
							price: 0,
							quantity: 0
						};
					}
					txData[thisRationalDate].price = closingPrice;
					txData[thisRationalDate].quantity += tx.ethValue;
				}
			});
		}
		if (transactions[thisBlock].withdrawals) {
			transactions[thisBlock].withdrawals.forEach((withdrawal) => {
				if (!txData[thisRationalDate]) {
					txData[thisRationalDate] = {
						price: 0,
						quantity: 0
					};
				}
				txData[thisRationalDate].price = closingPrice;
				txData[thisRationalDate].quantity += withdrawal.ethValue;
			});
		}
	});
	// sort our txData object by key in ascending order
	let sortedTxData = sortObjectKeys(txData);
	transactions = [];
	Object.keys(sortedTxData).forEach((thisDate) => {
		transactions.push({ [thisDate]: sortedTxData[thisDate] });
	});
	txData = null;
	sortedTxData = null;

	// transform sellCSV data into JSON object
	let sellsCSV = fs.readFileSync(SELLFILE, 'utf-8');
	let lines = sellsCSV.split('\n');
	
	for (let i = 0; i < lines.length; i++) {
		const values = lines[i].split(',');
		if (values[0]) {
			sells.push({ [values[0]]: { quantity: Number(values[1]), costBasis: 0, shortTerm: 0, longTerm: 0 } });
		}
	}
	sellsCSV = null;
	lines = null;

	buyTotal = await getInventoryValueAndQuantity();
	sellTotal = await getSellQuantity();
	await sell();
}

go();