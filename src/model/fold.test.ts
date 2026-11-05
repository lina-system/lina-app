import { expect, test } from "vitest";
import { foldReason } from "./fold";

test("a comment shows as it is unless it would show a path, a command, a hash, an issue number, an address or a fragment", () => {
  for (const plain of ["오류 문구 초안을 공유했어요.", "카드 번호는 앞 여섯 자리까지 보여 줄까요?", "1.5배 빨라졌어요."]) expect(foldReason(plain)).toBeNull();
  expect(foldReason("src/payment/card-form 정리")).toBe("path");
  expect(foldReason("CHANGES.md 반영")).toBe("path");
  expect(foldReason("~/notes 보세요")).toBe("path");
  expect(foldReason("npm test --run 돌림")).toBe("command");
  expect(foldReason("`work next` 실행")).toBe("command");
  expect(foldReason("$ make dev 로 확인")).toBe("command");
  expect(foldReason("커밋 3f2a1c9 에 들어감")).toBe("hash");
  expect(foldReason("#36 끝나면 시작")).toBe("issue");
  expect(foldReason("lina-system/lina#201 기다림")).toBe("issue");
  expect(foldReason("https://example.org 참고")).toBe("address");
  expect(foldReason("카드사별로 바꾸는 중인데…")).toBe("fragment");
  expect(foldReason("   ")).toBe("fragment");
  // English words are raw text, except the names the core's checked lines allow.
  expect(foldReason("위키: people 정리")).toBe("latin");
  expect(foldReason("Running npm test in packages")).toBe("latin");
  expect(foldReason("LINA 코어 정리")).toBeNull();
  expect(foldReason("CI 기다림")).toBeNull();
});
