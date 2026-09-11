# OpenManus clean reproduction attempts 01-03

Status: `FAIL_HARNESS`

These three clean reproduction attempts were reported from the Windows PowerShell environment under `C:\Projetos\naia` after the contract suite had already passed 7/7.

## Common observed environment

- NaIA branch: `experiment/openmanus-exec-01`
- Node: `v24.18.0`
- Host Python: `3.13.14`
- OpenManus pinned SHA: `3309bf4e416fb1c74b008f3e86494439a31bad53`
- Clean mode: runtime directory removed and recreated before each attempt

## Common successful stages

Each attempt completed all of the following before failing:

1. clean runtime reset;
2. environment version checks;
3. NaIA baseline suite: `18/18 PASS`;
4. fresh OpenManus clone;
5. detached checkout of the pinned SHA;
6. virtual environment creation;
7. experiment Python version check.

Observed NaIA baseline durations across the three attempts were approximately:

- attempt 01: `847.7163 ms`
- attempt 02: `1454.1342 ms`
- attempt 03: `570.9829 ms`

## Common failure

All three attempts failed at the runner's pip upgrade command:

```text
venv-openmanus\Scripts\pip.exe install --upgrade pip
```

The installed pip returned:

```text
ERROR: To modify pip, please run the following command:
...\venv-openmanus\Scripts\python.exe -m pip install --upgrade pip
```

The runner correctly propagated the non-zero exit code after the earlier hardening change.

## Classification

This is classified as `FAIL_HARNESS`, not a candidate failure, because the failure is caused by the experiment bootstrap command and occurs before OpenManus requirements installation or execution of the candidate contract suite.

The correction is to use the interpreter-bound form for both upgrade and requirements installation:

```text
python.exe -m pip install --upgrade pip
python.exe -m pip install -r requirements.txt
```

## Candidate state after attempts 01-03

```text
NaIA baseline: PASS (18/18 on all three attempts)
OpenManus SHA verification: PASS
Clean checkout: PASS
Clean venv creation: PASS
Requirements install: NOT_EXECUTED
Contract suite in clean environment: NOT_EXECUTED
Clean reproduction gate: NOT_SATISFIED
Candidate rejection: NO
```
