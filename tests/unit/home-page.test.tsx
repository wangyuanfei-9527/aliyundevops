import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "../../app/page";

describe("HomePage", () => {
  it("renders the console heading and wizard step bar", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: "阿里云测试环境控制台" })).toBeInTheDocument();
    expect(screen.getByText("项目信息")).toBeInTheDocument();
    expect(screen.getByText("资源推导")).toBeInTheDocument();
  });
});
