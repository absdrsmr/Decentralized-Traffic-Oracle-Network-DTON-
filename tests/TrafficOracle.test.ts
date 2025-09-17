import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV, intCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_TIMESTAMP = 101;
const ERR_INVALID_LOCATION = 102;
const ERR_INVALID_SPEED = 103;
const ERR_INVALID_CONGESTION = 104;
const ERR_INVALID_INCIDENT = 105;
const ERR_REPORT_ALREADY_EXISTS = 106;
const ERR_REPORT_NOT_FOUND = 107;
const ERR_USER_NOT_REGISTERED = 108;
const ERR_INVALID_DATA_HASH = 109;
const ERR_MAX_REPORTS_EXCEEDED = 110;
const ERR_INVALID_GPS = 111;
const ERR_ORACLE_NOT_VERIFIED = 112;

interface TrafficReport {
  reporter: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  speed: number;
  congestion: number;
  incidentType: string;
  dataHash: string;
  locationHash: string;
  validated: boolean;
}

interface UserSubmissions {
  totalSubmissions: number;
  lastSubmission: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class TrafficOracleMock {
  state: {
    nextReportId: number;
    maxReports: number;
    submissionFee: number;
    authorityContract: string | null;
    minSpeed: number;
    maxSpeed: number;
    minCongestion: number;
    maxCongestion: number;
    trafficReports: Map<number, TrafficReport>;
    reportsByLocation: Map<string, number[]>;
    userSubmissions: Map<string, UserSubmissions>;
  } = {
    nextReportId: 0,
    maxReports: 5000,
    submissionFee: 50,
    authorityContract: null,
    minSpeed: 0,
    maxSpeed: 200,
    minCongestion: 0,
    maxCongestion: 100,
    trafficReports: new Map(),
    reportsByLocation: new Map(),
    userSubmissions: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  authorities: Set<string> = new Set(["ST1TEST"]);
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextReportId: 0,
      maxReports: 5000,
      submissionFee: 50,
      authorityContract: null,
      minSpeed: 0,
      maxSpeed: 200,
      minCongestion: 0,
      maxCongestion: 100,
      trafficReports: new Map(),
      reportsByLocation: new Map(),
      userSubmissions: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.authorities = new Set(["ST1TEST"]);
    this.stxTransfers = [];
  }

  isVerifiedAuthority(principal: string): Result<boolean> {
    return { ok: true, value: this.authorities.has(principal) };
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: false };
    }
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setSubmissionFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.submissionFee = newFee;
    return { ok: true, value: true };
  }

  setSpeedLimits(minSpd: number, maxSpd: number): Result<boolean> {
    if (minSpd <= 0 || maxSpd >= 300) return { ok: false, value: false };
    this.state.minSpeed = minSpd;
    this.state.maxSpeed = maxSpd;
    return { ok: true, value: true };
  }

  submitTrafficReport(
    lat: number,
    lon: number,
    speed: number,
    congestion: number,
    incident: string,
    dataHash: string
  ): Result<number> {
    if (this.state.nextReportId >= this.state.maxReports) return { ok: false, value: ERR_MAX_REPORTS_EXCEEDED };
    if (this.blockHeight < this.blockHeight) return { ok: false, value: ERR_INVALID_TIMESTAMP };
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { ok: false, value: ERR_INVALID_GPS };
    if (speed < this.state.minSpeed || speed > this.state.maxSpeed) return { ok: false, value: ERR_INVALID_SPEED };
    if (congestion < this.state.minCongestion || congestion > this.state.maxCongestion) return { ok: false, value: ERR_INVALID_CONGESTION };
    if (!["accident", "construction", "none"].includes(incident)) return { ok: false, value: ERR_INVALID_INCIDENT };
    if (dataHash.length !== 64) return { ok: false, value: ERR_INVALID_DATA_HASH };
    const locHash = this.generateLocationHash(lat, lon);
    if (locHash.length !== 64) return { ok: false, value: ERR_INVALID_DATA_HASH };
    if (this.state.reportsByLocation.has(locHash)) return { ok: false, value: ERR_REPORT_ALREADY_EXISTS };
    if (!this.isUserRegistered(this.caller).value) return { ok: false, value: ERR_USER_NOT_REGISTERED };
    if (!this.state.authorityContract) return { ok: false, value: ERR_ORACLE_NOT_VERIFIED };

    this.stxTransfers.push({ amount: this.state.submissionFee, from: this.caller, to: this.state.authorityContract });

    const id = this.state.nextReportId;
    const report: TrafficReport = {
      reporter: this.caller,
      timestamp: this.blockHeight,
      latitude: lat,
      longitude: lon,
      speed,
      congestion,
      incidentType: incident,
      dataHash,
      locationHash: locHash,
      validated: false,
    };
    this.state.trafficReports.set(id, report);
    const reportList = this.state.reportsByLocation.get(locHash) || [];
    this.state.reportsByLocation.set(locHash, [...reportList, id]);
    const userSubs = this.state.userSubmissions.get(this.caller);
    this.state.userSubmissions.set(this.caller, userSubs ?
      { totalSubmissions: userSubs.totalSubmissions + 1, lastSubmission: this.blockHeight } :
      { totalSubmissions: 1, lastSubmission: this.blockHeight }
    );
    this.state.nextReportId++;
    return { ok: true, value: id };
  }

  private generateLocationHash(lat: number, lon: number): string {
    return "mock-sha256-" + lat.toString() + lon.toString();
  }

  private isUserRegistered(user: string): Result<boolean> {
    return { ok: true, value: true };
  }

  getReport(id: number): TrafficReport | null {
    return this.state.trafficReports.get(id) || null;
  }

  validateReport(reportId: number, validator: string): Result<boolean> {
    const report = this.state.trafficReports.get(reportId);
    if (!report) return { ok: false, value: false };
    if (report.reporter !== this.caller) return { ok: false, value: false };
    if (!this.isOracleVerified(validator).value) return { ok: false, value: false };
    this.state.trafficReports.set(reportId, { ...report, validated: true });
    return { ok: true, value: true };
  }

  private isOracleVerified(validator: string): Result<boolean> {
    return { ok: true, value: this.authorities.has(validator) };
  }

  getReportCount(): Result<number> {
    return { ok: true, value: this.state.nextReportId };
  }

  checkReportExistence(hash: string): Result<boolean> {
    return { ok: true, value: this.state.reportsByLocation.has(hash) };
  }
}

describe("TrafficOracle", () => {
  let contract: TrafficOracleMock;

  beforeEach(() => {
    contract = new TrafficOracleMock();
    contract.reset();
  });


  it("rejects invalid GPS coordinates", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.submitTrafficReport(100, -74.0060, 60, 30, "none", "hash1");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_GPS);
  });

  it("rejects invalid speed", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.submitTrafficReport(40.7128, -74.0060, 250, 30, "none", "hash1");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_SPEED);
  });

  it("rejects invalid incident type", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.submitTrafficReport(40.7128, -74.0060, 60, 30, "invalid", "hash1");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_INCIDENT);
  });

  it("rejects validation for non-existent report", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.validateReport(99, "ST1TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects validation by non-reporter", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.submitTrafficReport(40.7128, -74.0060, 60, 30, "none", "hash1");
    contract.caller = "ST3FAKE";
    const result = contract.validateReport(0, "ST3FAKE");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets submission fee successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setSubmissionFee(100);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.submissionFee).toBe(100);
  });

  it("parses report parameters with Clarity types", () => {
    const lat = intCV(40);
    const lon = intCV(-74);
    const speed = uintCV(60);
    const congestion = uintCV(30);
    const incident = stringUtf8CV("none");
    const dataHash = stringUtf8CV("hash123");
    expect(lat.value).toEqual(BigInt(40));
    expect(lon.value).toEqual(BigInt(-74));
    expect(speed.value).toEqual(BigInt(60));
    expect(congestion.value).toEqual(BigInt(30));
    expect(incident.value).toBe("none");
    expect(dataHash.value).toBe("hash123");
  });
});