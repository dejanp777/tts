"""
Regression Detection System

Compares current test metrics against baseline to detect regressions
"""
import json
from pathlib import Path
from typing import Dict, List, Any, Optional
from dataclasses import dataclass


@dataclass
class RegressionResult:
    """Result of a single regression check"""
    metric_name: str
    baseline_value: float
    current_value: float
    change_percent: float
    is_regression: bool
    severity: str  # 'critical', 'warning', 'info'
    threshold_exceeded: float  # How much threshold was exceeded


class RegressionDetector:
    """
    Detects regressions by comparing current metrics against baseline
    """

    def __init__(self, baseline_dir: Path, current_dir: Path):
        self.baseline_dir = Path(baseline_dir)
        self.current_dir = Path(current_dir)

        # Define regression thresholds per metric type
        self.thresholds = {
            # Lower is better - alert if increased
            'wer': {'warning': 0.10, 'critical': 0.20},  # 10%/20% increase
            'latency_ms': {'warning': 0.20, 'critical': 0.30},  # 20%/30% increase
            'false_interruption_rate': {'warning': 0.15, 'critical': 0.25},

            # Higher is better - alert if decreased
            'accuracy': {'warning': -0.05, 'critical': -0.10},  # 5%/10% decrease
            'pesq': {'warning': -0.05, 'critical': -0.10},
            'success_rate': {'warning': -0.10, 'critical': -0.15},
        }

    def load_metrics(self, path: Path) -> Dict[str, Any]:
        """Load metrics from JSON file"""
        if not path.exists():
            return {}

        with open(path, 'r') as f:
            return json.load(f)

    def get_metric_type(self, metric_name: str) -> Optional[str]:
        """Determine metric type from name"""
        for metric_type in self.thresholds.keys():
            if metric_type in metric_name:
                return metric_type
        return None

    def check_regression(self, metric_name: str, baseline_value: float,
                        current_value: float) -> Optional[RegressionResult]:
        """
        Check if a metric has regressed

        Args:
            metric_name: Name of the metric
            baseline_value: Baseline value
            current_value: Current value

        Returns:
            RegressionResult if regression detected, None otherwise
        """
        if baseline_value == 0:
            return None

        # Calculate percent change
        change_pct = ((current_value - baseline_value) / baseline_value)

        # Get metric type and thresholds
        metric_type = self.get_metric_type(metric_name)
        if not metric_type:
            return None

        thresholds = self.thresholds[metric_type]

        # Check if regression
        is_regression = False
        severity = 'info'
        threshold_exceeded = 0.0

        if metric_type in ['wer', 'latency_ms', 'false_interruption_rate']:
            # Lower is better - check if increased
            if change_pct > thresholds['critical']:
                is_regression = True
                severity = 'critical'
                threshold_exceeded = change_pct - thresholds['critical']
            elif change_pct > thresholds['warning']:
                is_regression = True
                severity = 'warning'
                threshold_exceeded = change_pct - thresholds['warning']
        else:
            # Higher is better - check if decreased
            if change_pct < thresholds['critical']:
                is_regression = True
                severity = 'critical'
                threshold_exceeded = abs(change_pct - thresholds['critical'])
            elif change_pct < thresholds['warning']:
                is_regression = True
                severity = 'warning'
                threshold_exceeded = abs(change_pct - thresholds['warning'])

        if is_regression:
            return RegressionResult(
                metric_name=metric_name,
                baseline_value=baseline_value,
                current_value=current_value,
                change_percent=change_pct * 100,
                is_regression=True,
                severity=severity,
                threshold_exceeded=threshold_exceeded * 100
            )

        return None

    def detect_regressions(self) -> Dict[str, List[RegressionResult]]:
        """
        Detect all regressions across all metric files

        Returns:
            Dictionary mapping severity to list of regressions
        """
        regressions = {
            'critical': [],
            'warning': [],
            'info': []
        }

        # Find all metric files
        current_files = list(self.current_dir.glob('*_metrics.json'))

        for current_file in current_files:
            baseline_file = self.baseline_dir / current_file.name

            if not baseline_file.exists():
                print(f"No baseline for {current_file.name}, skipping")
                continue

            # Load metrics
            current_metrics = self.load_metrics(current_file)
            baseline_metrics = self.load_metrics(baseline_file)

            # Compare each metric
            for metric_name, current_stats in current_metrics.get('metrics', {}).items():
                if metric_name not in baseline_metrics.get('metrics', {}):
                    continue

                baseline_stats = baseline_metrics['metrics'][metric_name]

                # Use mean for comparison
                current_value = current_stats.get('mean', 0)
                baseline_value = baseline_stats.get('mean', 0)

                # Check for regression
                result = self.check_regression(metric_name, baseline_value, current_value)

                if result:
                    regressions[result.severity].append(result)

        return regressions

    def print_report(self, regressions: Dict[str, List[RegressionResult]]):
        """Print regression report"""
        total = sum(len(r) for r in regressions.values())

        if total == 0:
            print("\n" + "=" * 80)
            print("✅ NO REGRESSIONS DETECTED")
            print("=" * 80)
            return

        print("\n" + "=" * 80)
        print(f"⚠️  REGRESSIONS DETECTED: {total} total")
        print("=" * 80)

        for severity in ['critical', 'warning', 'info']:
            if not regressions[severity]:
                continue

            emoji = {'critical': '🔴', 'warning': '🟡', 'info': 'ℹ️'}[severity]
            print(f"\n{emoji} {severity.upper()} ({len(regressions[severity])})")
            print("-" * 80)

            for reg in regressions[severity]:
                direction = "↑" if reg.change_percent > 0 else "↓"
                print(f"\n  {reg.metric_name}:")
                print(f"    Baseline: {reg.baseline_value:.4f}")
                print(f"    Current:  {reg.current_value:.4f}")
                print(f"    Change:   {direction} {abs(reg.change_percent):.1f}%")
                print(f"    Exceeded threshold by: {reg.threshold_exceeded:.1f}%")

        print("\n" + "=" * 80)

    def save_report(self, regressions: Dict[str, List[RegressionResult]],
                   output_path: Path):
        """Save regression report to JSON"""
        report = {
            'total_regressions': sum(len(r) for r in regressions.values()),
            'by_severity': {
                severity: len(regs) for severity, regs in regressions.items()
            },
            'regressions': []
        }

        for severity, regs in regressions.items():
            for reg in regs:
                report['regressions'].append({
                    'metric_name': reg.metric_name,
                    'severity': severity,
                    'baseline_value': reg.baseline_value,
                    'current_value': reg.current_value,
                    'change_percent': reg.change_percent,
                    'threshold_exceeded': reg.threshold_exceeded
                })

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w') as f:
            json.dump(report, f, indent=2)

        print(f"\nRegression report saved to: {output_path}")

    def has_critical_regressions(self, regressions: Dict[str, List[RegressionResult]]) -> bool:
        """Check if there are any critical regressions"""
        return len(regressions['critical']) > 0


def main():
    """Main entry point for regression detection"""
    import sys
    from pathlib import Path

    # Default paths
    baseline_dir = Path(__file__).parent / "baseline"
    current_dir = Path(__file__).parent / "results"

    # Parse command line args
    if len(sys.argv) > 1:
        baseline_dir = Path(sys.argv[1])
    if len(sys.argv) > 2:
        current_dir = Path(sys.argv[2])

    print(f"Baseline dir: {baseline_dir}")
    print(f"Current dir:  {current_dir}")

    # Run detection
    detector = RegressionDetector(baseline_dir, current_dir)
    regressions = detector.detect_regressions()

    # Print report
    detector.print_report(regressions)

    # Save report
    output_path = current_dir / "regression_report.json"
    detector.save_report(regressions, output_path)

    # Exit with error if critical regressions found
    if detector.has_critical_regressions(regressions):
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
