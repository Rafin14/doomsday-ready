# Quality checks

Run these from the project folder with Node.js 24 or later:

```sh
npm ci
npm test
npm run test:e2e
```

The browser command builds the app and uses an installed Google Chrome. It starts its own local server on an available port. The suites use temporary databases and leave `data/doomsday.sqlite` alone.

## What the audit found

| Finding | Change and regression check |
| --- | --- |
| Future release years passed through the form and API. | The minimum is 1888 and the maximum is the current UTC year. The tests cover the limits, invalid types, update rollback, and continued editing of older records that already hold out-of-range years. |
| A pending prerequisite write could be submitted again after switching editors or views. | The app shares each movie’s save state across views. A browser test delays a save, navigates away and back, confirms the controls stay disabled, and verifies the saved result. |
| Completing or canceling an edit could leave a keyboard user without a focused control. | Focus returns to Title after adding a movie and to the originating Edit button after saving or canceling a prerequisite change. Chrome tests all three paths. |
| A non-JSON API failure could display an internal parser error. | The client provides a plain-language error and the initial load offers a retry. The browser test supplies an HTML error response and verifies recovery. |
| Persistence coverage only checked a watched flag written directly to SQLite. | The tests create records via the API, reopen the database, and check that a new movie, prerequisite links, a watched flag, and a cinema survive without duplicate seeds. |

## Automated coverage

- **Movies and graph.** Test the sample watch lists, shared ancestors, order, direct and indirect cycles, clearing prerequisites, missing and repeated IDs, rollback, boundary years and runtimes, and a 15,000-link chain. Compare all 16,384 target/graph pairs from directed four-movie graphs without self-links against an independent reachability calculation. Direct self-links are covered by the API tests.
- **Cinema and booking.** Test the assessment examples, the 1 and 10,000 seat limits, the maximum of 10 distinct sizes, oversized and repeated bundles, impossible quotes, and how the solver chooses between equally short quotes. Compare 40,920 small bundle-set/target pairs against an independent breadth-first search and verify reconstruction adds up to the quoted number of seats.
- **HTTP and storage.** Test duplicate and missing resources, simultaneous creates with the same name, invalid IDs, malformed, oversized, and unsupported-charset JSON, invalid query values, transactions, and SQLite reopen behavior.
- **Chrome.** Check movie creation and editing, cycle errors, watch progress and zero-prerequisite targets, cinema creation, possible and impossible quotes, retry, focus recovery, layout widths from 320 to 1440 pixels, and reduced motion.

## Manual checks

1. Run `npm run dev` and open [the local app](http://localhost:3000).
2. Try a future release year, then enter the current year and save. Mark only Iron Man watched and open the Doomsday plan. With fresh seed data it should show **1 of 7 watched** and **14 hr 34 min** left.
3. Request six seats at Starlight Cinema for **two 3-seat bundles**. Choose Rex Theatre and request seven for **Not possible**.
4. Refresh and verify that watched changes and any added records persist.

Docker Compose was reviewed statically. A container run and Safari or Firefox browser checks remain outside the verified results.
