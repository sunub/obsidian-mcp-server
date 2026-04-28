import { describe, expect, test } from "vitest";
import { Semaphore } from "../../src/utils/semaphore";

describe("Semaphore", () => {
	test("permits 수만큼 동시 acquire가 가능하다", async () => {
		const sem = new Semaphore(3);
		// 3개까지 즉시 resolve 되어야 한다
		await sem.acquire();
		await sem.acquire();
		await sem.acquire();
		// 여기까지 도달했으면 성공
		expect(true).toBe(true);
	});

	test("permits가 소진되면 acquire가 블로킹된다", async () => {
		const sem = new Semaphore(1);
		await sem.acquire(); // permits: 0

		let secondAcquired = false;
		const waiting = sem.acquire().then(() => {
			secondAcquired = true;
		});

		// 마이크로태스크 플러시 후에도 두 번째 acquire는 여전히 대기 중이어야 한다
		await Promise.resolve();
		expect(secondAcquired).toBe(false);

		sem.release(); // 대기 중인 acquire를 해제
		await waiting;
		expect(secondAcquired).toBe(true);
	});

	test("release는 대기열의 FIFO 순서를 보장한다", async () => {
		const sem = new Semaphore(1);
		await sem.acquire();

		const order: number[] = [];

		const p1 = sem.acquire().then(() => order.push(1));
		const p2 = sem.acquire().then(() => order.push(2));
		const p3 = sem.acquire().then(() => order.push(3));

		// 3개 모두 대기 상태
		sem.release(); // → p1 해제
		await p1;
		sem.release(); // → p2 해제
		await p2;
		sem.release(); // → p3 해제
		await p3;

		expect(order).toEqual([1, 2, 3]);
	});

	test("대기열이 비어 있을 때 release하면 permits가 복구된다", async () => {
		const sem = new Semaphore(1);
		await sem.acquire(); // permits: 0
		sem.release(); // 대기열 비어 있으므로 permits: 1

		// permits가 다시 1이므로 즉시 acquire 가능
		let acquired = false;
		sem.acquire().then(() => {
			acquired = true;
		});
		await Promise.resolve();
		expect(acquired).toBe(true);
	});

	test("동시성 제한이 정확히 지켜진다", async () => {
		const sem = new Semaphore(2);
		let concurrent = 0;
		let maxConcurrent = 0;

		const task = async (_: number) => {
			await sem.acquire();
			concurrent++;
			maxConcurrent = Math.max(maxConcurrent, concurrent);
			// 비동기 작업 시뮬레이션
			await new Promise((r) => setTimeout(r, 10));
			concurrent--;
			sem.release();
		};

		await Promise.all([task(1), task(2), task(3), task(4), task(5)]);

		expect(maxConcurrent).toBe(2);
	});

	test("permits 0으로 초기화하면 첫 acquire부터 블로킹된다", async () => {
		const sem = new Semaphore(0);

		let acquired = false;
		const waiting = sem.acquire().then(() => {
			acquired = true;
		});

		await Promise.resolve();
		expect(acquired).toBe(false);

		sem.release();
		await waiting;
		expect(acquired).toBe(true);
	});
});
