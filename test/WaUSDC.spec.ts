import { expect } from "chai";
import { ethers } from "hardhat";

describe("WaUSDC - user flow with getInterestSubsidy and redeemWithInterestSubsidy", function () {
  let MockERC20: any;
  let MockDebtLens: any;
  let MockOracle: any;
  let WaUSDC: any;

  let aToken: any;
  let debtLens: any;
  let oracle: any;
  let vault: any;

  let owner: any;
  let user1: any;
  let user2: any;

  const DECIMALS = 6;

  beforeEach(async () => {
    [owner, user1, user2] = await ethers.getSigners();

    MockERC20 = await ethers.getContractFactory("MockERC20");
    aToken = await MockERC20.deploy("Mock aUSDC", "aUSDC", DECIMALS, owner.address);
    await aToken.waitForDeployment();

    MockDebtLens = await ethers.getContractFactory("MockDebtLens");
    debtLens = await MockDebtLens.deploy();
    await debtLens.waitForDeployment();

    MockOracle = await ethers.getContractFactory("MockOracle");
    // set oracle price to 1 CCOP per WaUSDC 
    oracle = await MockOracle.deploy(ethers.parseUnits("1", 36));
    await oracle.waitForDeployment();

    WaUSDC = await ethers.getContractFactory("WaUSDC");
    vault = await WaUSDC.deploy(aToken.target, owner.address);
    await vault.waitForDeployment();

    // configure integrations
    await vault.connect(owner).setDebtLens(debtLens.target);
    await vault.connect(owner).setCCOPUsdcOracle(oracle.target);
    await vault.connect(owner).setMarketId(ethers.encodeBytes32String("test-market-1"));

    // mint aToken to users
    await aToken.mint(user1.address, ethers.parseUnits("1000", DECIMALS));
    await aToken.mint(user2.address, ethers.parseUnits("1000", DECIMALS));
  });

  it("deposit, yield, getInterestSubsidy, and redeemWithInterestSubsidy works", async () => {
    // user1 deposits 100 aUSD (principal)
    await aToken.connect(user1).approve(vault.target, ethers.parseUnits("100", DECIMALS));
    await vault.connect(user1).deposit(ethers.parseUnits("100", DECIMALS), user1.address);

    // simulate Aave yield: mint 10 aToken to vault
    await aToken.mint(vault.target, ethers.parseUnits("10", DECIMALS));

    // now totalAssets = 110, totalPrincipal = 100 -> availableYield = 10
    expect(await vault.totalAssets()).to.equal(ethers.parseUnits("110", DECIMALS));
    expect(await vault.totalPrincipal()).to.equal(ethers.parseUnits("100", DECIMALS));
    expect(await vault.availableYield()).to.equal(ethers.parseUnits("10", DECIMALS));

    // set accrued interest in CCOP for user1: 5 CCOP (6 decimals)
    await debtLens.setAccruedInterest(ethers.encodeBytes32String("test-market-1"), user1.address, ethers.parseUnits("5", DECIMALS));

    // -----ISSUE!!!!----better wausdc but issue with totalAllocatedSubsidy in case of getInterestSubsidy being invoked several times by the same user before repaying
    // user1 calls getInterestSubsidy() -> with oracle price = 1 (1e36), subsidy = interestCCOP * 1e36 / price = interestCCOP
    const subsidy = await vault.connect(user1).getInterestSubsidy(user1.address);
    // subsidy should be 5 aUSDC units
    expect(await vault.userInterestSubsidyInWaUSDC(user1.address)).to.equal(ethers.parseUnits("5", DECIMALS));
    expect(await vault.totalAllocatedSubsidy()).to.equal(ethers.parseUnits("5", DECIMALS));
    expect(await vault.availableYield()).to.equal(ethers.parseUnits("5", DECIMALS)); // 10 - 5 allocated

    // user1 redeems all shares with subsidy
    const shares = await vault.balanceOf(user1.address);
    await vault.connect(user1).redeemWithInterestSubsidy(shares, user1.address, user1.address);

    // user1 originally had 1000, deposited 100 -> 900; after redeem they should have 900 + principal(100) + subsidy(5) = 1005
    const user1Bal = await aToken.balanceOf(user1.address);
    expect(user1Bal).to.equal(ethers.parseUnits("1005", DECIMALS));

    // vault assets left: 110 - 105 = 5
    expect(await vault.totalAssets()).to.equal(ethers.parseUnits("5", DECIMALS));
    expect(await vault.totalPrincipal()).to.equal(ethers.parseUnits("0", DECIMALS)); // principal reduced to 0 for user1
    expect(await vault.totalAllocatedSubsidy()).to.equal(ethers.parseUnits("0", DECIMALS)); // subsidy consumed
  });

  it("prevents subsidy reservation > availableYield", async () => {
    // user1 deposits 100
    await aToken.connect(user1).approve(vault.target, ethers.parseUnits("100", DECIMALS));
    await vault.connect(user1).deposit(ethers.parseUnits("100", DECIMALS), user1.address);

    // no yield minted, availableYield == 0
    await debtLens.setAccruedInterest(ethers.encodeBytes32String("test-market-1"), user1.address, ethers.parseUnits("1", DECIMALS));
    await expect(vault.connect(user1).getInterestSubsidy(user1.address)).to.be.revertedWith("insufficient available yield");
  });
});