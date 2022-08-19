/************************************************
 * IMPORTS
 ************************************************/

const express = require("express");
const ethers = require('ethers');
const bondABI = require('./bond')
const bondFourABI = require('./bondFour')
const customBondABI = require('./bondV2')
const lpABI = require('./pancakeLP.json');
const { text } = require("express");
const { default: axios } = require("axios");
require('dotenv').config()

const RPC = "https://rpc01-sg.dogechain.dog"

var provider = new ethers.providers.JsonRpcProvider(RPC);
const walletForControl = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const bonds = [
	// list your bonds
	{
		address: "0xdc0d8F9a2eDc092AdB4f5b48f63ed38b83b23480", // WDOGE
		type: "custom"
	},
];

// token-USD LP address for getting token price
const LPAddress = "0x6be57438D8FFE899953037A7cC365B8a97eE36Dd"
// standard bond's discount
const standardDiscount = 0.3;
// available bond price offset
const tolerance = 0.05;


/************************************************
 * CONSTANTS
 ************************************************/

const port = 3006;

/************************************************
 * INITIALIZE GLOBAL
 ************************************************/

const app = express();

const main = async () => {

	// getting token price from token-busd LP
	const lpContract = new ethers.Contract(
		LPAddress,
		lpABI,
		walletForControl
	)

	try {
		const result = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=DOGEBUSD');
		const dogePrice = result.data.price;
		const reserves = await lpContract.getReserves();
		const tokenPrice = reserves._reserve1 / reserves._reserve0 / 10 ** 9 * dogePrice;
		console.log('tokenPrice', tokenPrice);
		const bondPrice = tokenPrice * (1 - standardDiscount);

		for (let index = 0; index < bonds.length; index++) {
			console.log('adjusting bond-', bonds[index].address);
			const bondContract = new ethers.Contract(
				bonds[index].address,
				bonds[index].type == "four" ? bondFourABI : (bonds[index].type == "custom" ? customBondABI : bondABI),
				walletForControl
			);
			const bondTerms = await bondContract.terms();
			const totalDebt = await bondContract.totalDebt();
			const currentBondPriceInUSD = (await bondContract.bondPriceInUSD()) / 10 ** 18;
			const currentBondPrice = (await bondContract.bondPrice()) / 100;
			var newControlVariable = bondTerms.controlVariable;
			if(totalDebt >= 10000000000000) {
				if(bonds[index].type != 'custom') {
					newControlVariable = Math.floor(bondTerms.controlVariable * ((currentBondPrice * bondPrice / currentBondPriceInUSD) - 1) / (currentBondPrice - 1))
				}
				else {
					newControlVariable = Math.floor(bondTerms.controlVariable * bondPrice / currentBondPriceInUSD);
				}
			}
			console.log(`current bond price is ${currentBondPriceInUSD}, target bond price is ${bondPrice}, new control variable is ${newControlVariable} last control variable is ${bondTerms.controlVariable}`)
			if (totalDebt >= 10000000000000 && newControlVariable > bondTerms.controlVariable * (1 - tolerance) && newControlVariable < bondTerms.controlVariable * (1 + tolerance)) {
				console.log('there is no necessary to reinitialize')
				continue;
			}
			console.log('reinitializing bond terms...');
			if(bonds[index].type == "normal") {
				const result = await bondContract.initializeBondTerms(
					newControlVariable,
					bondTerms.vestingTerm,
					bondTerms.minimumPrice,
					bondTerms.maxPayout,
					bondTerms.fee,
					bondTerms.maxDebt,
					totalDebt >= 10000000000000 ? totalDebt : 10000000000000
				);
				await result.wait();
				console.log('reinitialize finished ... Tx hash is ', result?.hash)
			}
			else if(bonds[index].type == "four"){
				const result = await bondContract.initializeBondTerms(
					newControlVariable,
					bondTerms.minimumPrice,
					bondTerms.maxPayout,
					bondTerms.fee,
					bondTerms.maxDebt,
					totalDebt >= 10000000000000 ? totalDebt : 10000000000000,
					bondTerms.vestingTerm
				);
				await result.wait();
				console.log('reinitialize finished ... Tx hash is ', result?.hash)
			}
			else if(bonds[index].type == "custom") {
				const result = await bondContract.initializeBondTerms(
					newControlVariable,
					bondTerms.vestingTerm,
					bondTerms.minimumPrice,
					bondTerms.maxPayout,
					bondTerms.maxDebt,
					totalDebt >= 10000000000000 ? totalDebt : 10000000000000,
				);
				await result.wait();
				console.log('reinitialize finished ... Tx hash is ', result?.hash)
			}
		}
		console.log('all operation completed');
	} catch (error) {
		console.log(error);
	}

}



/************************************************
 * METHOD FOR LOG APP
 ************************************************/

app.listen(port, () => {
	console.log(`App start on port ${port}`);
	console.log("");
});

app.get('/', async function (req, res) {
	await main();
	res.send('successfully set')
})