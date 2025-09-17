(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-TIMESTAMP u101)
(define-constant ERR-INVALID-LOCATION u102)
(define-constant ERR-INVALID-SPEED u103)
(define-constant ERR-INVALID-CONGESTION u104)
(define-constant ERR-INVALID-INCIDENT u105)
(define-constant ERR-REPORT-ALREADY-EXISTS u106)
(define-constant ERR-REPORT-NOT-FOUND u107)
(define-constant ERR-USER-NOT-REGISTERED u108)
(define-constant ERR-INVALID-DATA-HASH u109)
(define-constant ERR-MAX-REPORTS-EXCEEDED u110)
(define-constant ERR-INVALID-GPS u111)
(define-constant ERR-ORACLE-NOT-VERIFIED u112)

(define-data-var next-report-id uint u0)
(define-data-var max-reports uint u5000)
(define-data-var submission-fee uint u50)
(define-data-var authority-contract (optional principal) none)
(define-data-var min-speed uint u0)
(define-data-var max-speed uint u200)
(define-data-var min-congestion uint u0)
(define-data-var max-congestion uint u100)

(define-map traffic-reports
  uint
  {
    reporter: principal,
    timestamp: uint,
    latitude: int,
    longitude: int,
    speed: uint,
    congestion: uint,
    incident-type: (string-utf8 50),
    data-hash: (string-utf8 64),
    location-hash: (string-utf8 64),
    validated: bool
  }
)

(define-map reports-by-location
  (string-utf8 64)
  (list 10 uint)
)

(define-map user-submissions
  principal
  {
    total-submissions: uint,
    last-submission: uint
  }
)

(define-read-only (get-report (id uint))
  (map-get? traffic-reports id)
)

(define-read-only (get-reports-by-location (loc-hash (string-utf8 64)))
  (map-get? reports-by-location loc-hash)
)

(define-read-only (get-user-submissions (user principal))
  (map-get? user-submissions user)
)

(define-read-only (is-report-registered (hash (string-utf8 64)))
  (is-some (map-get? reports-by-location hash))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-location (lat int) (lon int))
  (if (and (<= -90 lat) (<= lat 90) (<= -180 lon) (<= lon 180))
      (ok true)
      (err ERR-INVALID-GPS))
)

(define-private (validate-speed (spd uint))
  (if (and (>= spd (var-get min-speed)) (<= spd (var-get max-speed)))
      (ok true)
      (err ERR-INVALID-SPEED))
)

(define-private (validate-congestion (cong uint))
  (if (and (>= cong (var-get min-congestion)) (<= cong (var-get max-congestion)))
      (ok true)
      (err ERR-INVALID-CONGESTION))
)

(define-private (validate-incident-type (typ (string-utf8 50)))
  (if (or (is-eq typ u"accident") (is-eq typ u"construction") (is-eq typ u"none"))
      (ok true)
      (err ERR-INVALID-INCIDENT))
)

(define-private (validate-data-hash (hash (string-utf8 64)))
  (if (is-eq (len hash) u64)
      (ok true)
      (err ERR-INVALID-DATA-HASH))
)

(define-private (validate-location-hash (loc-hash (string-utf8 64)))
  (if (is-eq (len loc-hash) u64)
      (ok true)
      (err ERR-INVALID-DATA-HASH))
)

(define-private (validate-principal (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-NOT-AUTHORIZED))
)

(define-private (generate-location-hash (lat int) (lon int))
  (let ((lat-str (int-to-utf8 lat))
        (lon-str (int-to-utf8 lon)))
    (sha256 (concat lat-str lon-str)))
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (asserts! (not (is-eq contract-principal 'SP000000000000000000002Q6VF78)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-none (var-get authority-contract)) (err ERR-ORACLE-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-reports (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-INVALID-DATA-HASH))
    (asserts! (is-some (var-get authority-contract)) (err ERR-ORACLE-NOT-VERIFIED))
    (var-set max-reports new-max)
    (ok true)
  )
)

(define-public (set-submission-fee (new-fee uint))
  (begin
    (asserts! (>= new-fee u0) (err ERR-INVALID-DATA-HASH))
    (asserts! (is-some (var-get authority-contract)) (err ERR-ORACLE-NOT-VERIFIED))
    (var-set submission-fee new-fee)
    (ok true)
  )
)

(define-public (set-speed-limits (min-spd uint) (max-spd uint))
  (begin
    (asserts! (and (> min-spd u0) (< max-spd u300)) (err ERR-INVALID-SPEED))
    (asserts! (is-some (var-get authority-contract)) (err ERR-ORACLE-NOT-VERIFIED))
    (var-set min-speed min-spd)
    (var-set max-speed max-spd)
    (ok true)
  )
)

(define-public (submit-traffic-report
  (lat int)
  (lon int)
  (speed uint)
  (congestion uint)
  (incident (string-utf8 50))
  (data-hash (string-utf8 64))
)
  (let (
        (next-id (var-get next-report-id))
        (current-max (var-get max-reports))
        (authority (var-get authority-contract))
        (loc-hash (generate-location-hash lat lon))
        (user-subs (map-get? user-submissions tx-sender))
      )
    (asserts! (< next-id current-max) (err ERR-MAX-REPORTS-EXCEEDED))
    (try! (validate-timestamp block-height))
    (try! (validate-location lat lon))
    (try! (validate-speed speed))
    (try! (validate-congestion congestion))
    (try! (validate-incident-type incident))
    (try! (validate-data-hash data-hash))
    (try! (validate-location-hash loc-hash))
    (asserts! (is-none (map-get? reports-by-location loc-hash)) (err ERR-REPORT-ALREADY-EXISTS))
    (asserts! (is-some (contract-call? .user-registry is-registered tx-sender)) (err ERR-USER-NOT-REGISTERED))
    (let ((authority-recipient (unwrap! authority (err ERR-ORACLE-NOT-VERIFIED))))
      (try! (stx-transfer? (var-get submission-fee) tx-sender authority-recipient))
    )
    (map-set traffic-reports next-id
      {
        reporter: tx-sender,
        timestamp: block-height,
        latitude: lat,
        longitude: lon,
        speed: speed,
        congestion: congestion,
        incident-type: incident,
        data-hash: data-hash,
        location-hash: loc-hash,
        validated: false
      }
    )
    (let ((report-list (default-to (list) (map-get? reports-by-location loc-hash)))
          (new-list (append report-list next-id)))
      (map-set reports-by-location loc-hash new-list)
    )
    (map-set user-submissions tx-sender
      {
        total-submissions: (if (is-some user-subs)
                               (+ (get total-submissions user-subs) u1)
                               u1),
        last-submission: block-height
      }
    )
    (var-set next-report-id (+ next-id u1))
    (print { event: "report-submitted", id: next-id })
    (ok next-id)
  )
)

(define-public (validate-report (report-id uint) (validator principal))
  (let ((report (map-get? traffic-reports report-id)))
    (match report
      r
        (begin
          (asserts! (is-some (contract-call? .oracle-validator is-verified validator)) (err ERR-ORACLE-NOT-VERIFIED))
          (map-set traffic-reports report-id
            (merge r { validated: true }))
          (print { event: "report-validated", id: report-id })
          (ok true)
        )
      (err ERR-REPORT-NOT-FOUND)
    )
  )
)

(define-public (get-report-count)
  (ok (var-get next-report-id))
)

(define-public (check-report-existence (hash (string-utf8 64)))
  (ok (is-report-registered hash))
)