// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// TEST-ONLY mock of a Chainlink ETH/USD aggregator (8 decimals). Its runtime bytecode is copied to a fixed test address
/// on the local Hardhat node by start-chain.mjs (hardhat_setCode), so no constructor ever runs: `setAnswer` fills the
/// round and stamps it with the block time (the server rejects answers older than the feed's heartbeat + 10 %).
/// Anyone may set the price; it only exists on the local test chain.
/// Compiled once with solc 0.8.26 (optimizer off) into mock-aggregator.json; recompile if you change this file.
contract MockAggregator {
    int256 private answer;
    uint256 private updatedAt;
    uint80 private roundId;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function setAnswer(int256 newAnswer) external {
        answer = newAnswer;
        updatedAt = block.timestamp;
        roundId += 1;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }
}
