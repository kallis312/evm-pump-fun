const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PumpFactory and BondingCurve", function () {
    let PumpFactory, BondingCurve, ERC20FixedSupply;
    let pumpFactory, bondingCurve, token;
    let owner, feeRecipient, feeRecipientSetter, user1, user2;
    let tokenTotalSupply, swapFeePercentage, virtualTokenReserve, virtualEthReserve;
    let ethAmountForLiquidity, ethAmountForLiquidityFee, ethAmountForDevReward;
    let uniswapV2RouterAddress;

    beforeEach(async function () {
        [owner, feeRecipient, feeRecipientSetter, user1, user2] = await ethers.getSigners();

        // Set up parameters based on the deployment script
        tokenTotalSupply = ethers.parseUnits("1000000000", 18); // 1 billion tokens
        swapFeePercentage = 1;
        ethAmountForLiquidity = ethers.parseEther("4");
        ethAmountForLiquidityFee = ethers.parseEther("0.1");
        ethAmountForDevReward = ethers.parseEther("0.1");

        // const totalEthReserveAtMigration = ethAmountForLiquidity.add(ethAmountForLiquidityFee).add(ethAmountForDevReward);
        // const totalTokenReserveAtMigration = tokenTotalSupply.mul(20).div(100); // 20% of total supply

        const totalEthReserveAtMigration = ethAmountForLiquidity + ethAmountForLiquidityFee + ethAmountForDevReward;
        const totalTokenReserveAtMigration = tokenTotalSupply * 2n / 100n; // 20% of total supply

        virtualTokenReserve = tokenTotalSupply;
        virtualEthReserve = (totalTokenReserveAtMigration * totalEthReserveAtMigration) / virtualTokenReserve;

        uniswapV2RouterAddress = "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24";

        // Deploy PumpFactory
        PumpFactory = await ethers.getContractFactory("PumpFactory");
        pumpFactory = await PumpFactory.deploy(
            tokenTotalSupply,
            swapFeePercentage,
            virtualTokenReserve,
            virtualEthReserve,
            ethAmountForLiquidity,
            ethAmountForLiquidityFee,
            ethAmountForDevReward,
            uniswapV2RouterAddress,
            feeRecipient.address,
            feeRecipientSetter.address
        );

        await pumpFactory.waitForDeployment();
    });

    describe("PumpFactory", function () {
        it("Should deploy PumpFactory with correct initial values", async function () {
            expect(await pumpFactory.tokenTotalSupply()).to.equal(tokenTotalSupply);
            expect(await pumpFactory.swapFeePercentage()).to.equal(swapFeePercentage);
            expect(await pumpFactory.feeRecipient()).to.equal(feeRecipient.address);
            expect(await pumpFactory.feeRecipientSetter()).to.equal(feeRecipientSetter.address);
        });

        it("Should create a new token and bonding curve", async function () {
            const tx = await pumpFactory.createToken("Test Token", "TST", "https://test.uri");
            const receipt = await tx.wait();

            const tokenCreatedEvent = receipt.logs.find(log => log.eventName === "TokenCreated");
            expect(tokenCreatedEvent).to.not.be.undefined;

            const tokenAddress = tokenCreatedEvent.args[0];
            const bondingCurveAddress = tokenCreatedEvent.args[1];

            expect(await pumpFactory.getTokenBondingCurve(tokenAddress)).to.equal(bondingCurveAddress);
            // expect(await pumpFactory.allTokensLength()).to.equal(1);
        });

        it("Should allow owner to update parameters", async function () {
            await pumpFactory.setSwapFeePercentage(2);
            expect(await pumpFactory.swapFeePercentage()).to.equal(2);

            await pumpFactory.setVirtualReserves(ethers.parseUnits("2000000000", 18), ethers.parseEther("10"));
            // Add more checks for other parameters
        });

        it("Should not allow non-owner to update parameters", async function () {
            await expect(pumpFactory.connect(user1).setSwapFeePercentage(2))
                .to.be.revertedWithCustomError(pumpFactory, "OwnableUnauthorizedAccount");
        });
    });

    describe("BondingCurve", function () {
        beforeEach(async function () {
            // Create a token and get its bonding curve
            const tx = await pumpFactory.createToken("Test Token", "TST", "https://test.uri");
            const receipt = await tx.wait();

            const tokenCreatedEvent = receipt.logs.find(log => log.eventName === "TokenCreated");

            const tokenAddress = tokenCreatedEvent.args[0];
            const bondingCurveAddress = tokenCreatedEvent.args[1];

            bondingCurve = await ethers.getContractAt("BondingCurve", bondingCurveAddress);
            token = await ethers.getContractAt("ERC20FixedSupply", tokenAddress);
        });

        it("Should allow users to buy tokens", async function () {
            const buyAmount = ethers.parseEther("1.01");
            await bondingCurve.connect(user1)["buy()"]({ value: buyAmount });

            const userBalance = await token.balanceOf(user1.address);
            expect(userBalance).to.be.gt(0);
        });

        it("Should allow users to sell tokens", async function () {
            // First, buy some tokens
            const buyAmount = ethers.parseEther("1");
            await bondingCurve.connect(user1)["buy()"]({ value: buyAmount });

            const initialBalance = await token.balanceOf(user1.address);

            // Approve tokens for sale
            await token.connect(user1).approve(bondingCurve.target, initialBalance);

            // Sell tokens
            await bondingCurve.connect(user1).sell(initialBalance);

            const finalBalance = await token.balanceOf(user1.address);
            expect(finalBalance).to.equal(0);
        });

        it("Should complete the bonding curve when sufficient ETH is provided", async function () {
            const initialEthToComplete = await bondingCurve.remainingEthToCompleteCurve();

            const initialEthToCompleteWithBuyFees = initialEthToComplete + _addFees(initialEthToComplete);

            // Buy tokens to complete the curve
            await bondingCurve.connect(user1)["buy()"]({ value: initialEthToCompleteWithBuyFees });

            // Check if the curve is completed
            expect(await bondingCurve.isActive()).to.be.false;

            //Try to buy more tokens(should fail)
            // await expect(bondingCurve.connect(user2)["buy()"]({ value: ethers.parseEther("1") }))
            //     .to.be.revertedWith("bonding curve must be active");
        });

        function _addFees(amount) {
            const feePercentage = BigInt(swapFeePercentage);
            return amount * feePercentage / 100n;
        }

        // it("Should distribute rewards correctly when curve is completed", async function () {
        //     const initialEthToComplete = await bondingCurve.remainingEthToCompleteCurve();
        //     const initialDevBalance = await ethers.provider.getBalance(await bondingCurve.TOKEN_DEVELOPER());
        //     const initialFeeRecipientBalance = await ethers.provider.getBalance(feeRecipient.address);

        //     // Complete the curve
        //     await bondingCurve.connect(user1)["buy()"]({ value: initialEthToComplete });

        //     // Check developer reward
        //     const finalDevBalance = await ethers.provider.getBalance(await bondingCurve.TOKEN_DEVELOPER());
        //     expect(finalDevBalance.sub(initialDevBalance)).to.equal(ethAmountForDevReward);

        //     // Check fee recipient reward
        //     const finalFeeRecipientBalance = await ethers.provider.getBalance(feeRecipient.address);
        //     expect(finalFeeRecipientBalance.sub(initialFeeRecipientBalance)).to.equal(ethAmountForLiquidityFee);
        // });
    });
});