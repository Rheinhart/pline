package local.cline;

import com.google.gson.*;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.content.Content;
import com.intellij.ui.content.ContentFactory;
import javax.swing.*;
import java.awt.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Map;

/** Swing-only host: no browser, telemetry client, socket or downloader. */
public final class LocalToolWindowFactory implements ToolWindowFactory {
    @Override public void createToolWindowContent(Project project, ToolWindow window) {
        LocalPanel panel = new LocalPanel(project);
        Content content = ContentFactory.getInstance().createContent(panel, "", false);
        content.setDisposer(panel);
        window.getContentManager().addContent(content);
    }

    private static final class LocalPanel extends JPanel implements Disposable {
        private static final long serialVersionUID = 1L;
        private final JTextArea output = textArea(18, 60);
        private final JTextArea input = textArea(5, 60);
        private final JLabel status = new JLabel("Cline Local · 仅连接配置的本机／内网模型");
        private final Project project;
        private Process process;
        private BufferedWriter writer;
        private boolean busy;
        private volatile boolean disposed;
        private final Gson gson = new GsonBuilder().setPrettyPrinting().create();

        LocalPanel(Project project) {
            super(new BorderLayout(6, 6));
            this.project = project;
            output.setEditable(false);
            JPanel bar = new JPanel(new FlowLayout(FlowLayout.LEFT));
            button(bar, "新任务", () -> { if (idle()) { output.setText(""); send("new", null); } });
            button(bar, "本地历史", () -> { if (idle()) send("history", null); });
            button(bar, "撤销", () -> { if (idle()) send("undo", null); });
            button(bar, "模型设置", this::settings);
            button(bar, "停止", () -> send("cancel", null));
            JPanel top = new JPanel(new BorderLayout()); top.add(bar, BorderLayout.NORTH); top.add(status, BorderLayout.SOUTH);
            add(top, BorderLayout.NORTH); add(new JScrollPane(output), BorderLayout.CENTER);
            JPanel bottom = new JPanel(new BorderLayout()); bottom.add(new JScrollPane(input), BorderLayout.CENTER);
            JButton submit = new JButton("发送"); bottom.add(submit, BorderLayout.SOUTH); add(bottom, BorderLayout.SOUTH);
            submit.addActionListener(event -> {
                if (!idle() || input.getText().isBlank()) return;
                String prompt = input.getText();
                if (prompt.length() > 65536) { append("输入超过 64 KiB。\n"); return; }
                append("\n你：\n" + prompt + "\n\nCline：\n"); input.setText(""); busy = true;
                send("prompt", Map.of("text", prompt));
            });
            // Start only when the tool window is opened. No network discovery or auto-update.
            start();
        }
        private static JTextArea textArea(int rows, int columns) {
            JTextArea area = new JTextArea(rows, columns); area.setLineWrap(true); area.setWrapStyleWord(true); return area;
        }
        private void button(JPanel panel, String label, Runnable action) {
            JButton button = new JButton(label); button.addActionListener(event -> action.run()); panel.add(button);
        }
        private boolean idle() { if (busy) { append("\n请先停止当前任务。\n"); return false; } return true; }
        private void append(String text) {
            if (output.getDocument().getLength() + text.length() > 2_000_000) output.setText("较早的显示内容已清除；完整会话保存在本机。\n");
            output.append(text); output.setCaretPosition(output.getDocument().getLength());
        }
        private void start() {
            try {
                if (!System.getProperty("os.name").toLowerCase().contains("linux") || !(System.getProperty("os.arch").equals("amd64") || System.getProperty("os.arch").equals("x86_64"))) {
                    throw new IOException("此安装包支持 Linux x86_64（含 Fedora）。");
                }
                String root = project.getBasePath();
                if (root == null) throw new IOException("请先打开本地项目。");
                Path jar = Paths.get(LocalToolWindowFactory.class.getProtectionDomain().getCodeSource().getLocation().toURI());
                Path binary = jar.getParent().getParent().resolve("bin/cline-local");
                if (!Files.isRegularFile(binary)) throw new IOException("安装包缺少本地核心；请重新安装完整 ZIP。");
                // ZIP extraction can lose executable bits. Only mark the bundled core executable.
                Files.setPosixFilePermissions(binary, PosixFilePermissions.fromString("rwxr-xr-x"));
                ProcessBuilder builder = new ProcessBuilder(binary.toString(), "--workspace", root);
                builder.environment().clear();
                builder.environment().put("HOME", System.getProperty("user.home"));
                builder.environment().put("PATH", "/usr/bin:/bin");
                builder.environment().put("LANG", "C.UTF-8");
                process = builder.start();
                writer = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
                Thread reader = new Thread(() -> {
                    try (BufferedReader stream = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = stream.readLine()) != null && !disposed) {
                            if (line.length() > 20_000_000) throw new IOException("本地核心消息超过限制。");
                            JsonObject event = JsonParser.parseString(line).getAsJsonObject();
                            SwingUtilities.invokeLater(() -> { if (!disposed) handle(event); });
                        }
                    } catch (Exception error) { SwingUtilities.invokeLater(() -> { if (!disposed) append("\n核心连接失败：" + error.getMessage() + "\n"); }); }
                    SwingUtilities.invokeLater(() -> { if (!disposed) { busy = false; status.setText("本地核心已停止，请重新打开工具窗口或 IDE。"); } });
                }, "cline-local-stdio"); reader.setDaemon(true); reader.start();
                Thread errors = new Thread(() -> {
                    // Runtime startup errors only; no transcripts or credentials are logged here.
                    try (BufferedReader stream = new BufferedReader(new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = stream.readLine()) != null && !disposed) {
                            String text = line.length() > 2000 ? line.substring(0, 2000) : line;
                            SwingUtilities.invokeLater(() -> { if (!disposed) append("\n核心：" + text + "\n"); });
                        }
                    } catch (IOException ignored) { }
                }, "cline-local-stderr"); errors.setDaemon(true); errors.start();
            } catch (Exception error) { append("启动失败：" + error.getMessage() + "\n"); }
        }
        private void send(String type, Map<String, ?> fields) {
            try {
                if (writer == null || process == null || !process.isAlive()) throw new IOException("本地核心未运行。");
                JsonObject message = new JsonObject(); message.addProperty("type", type);
                if (fields != null) for (Map.Entry<String, ?> field : fields.entrySet()) message.add(field.getKey(), new Gson().toJsonTree(field.getValue()));
                writer.write(new Gson().toJson(message)); writer.newLine(); writer.flush();
            } catch (IOException error) { busy = false; append("\n发送失败：" + error.getMessage() + "\n"); }
        }
        private static String string(JsonObject object, String key) { return object.has(key) && !object.get(key).isJsonNull() ? object.get(key).getAsString() : ""; }
        private static void addOptionalNumber(JsonObject config, String name, JTextField field, double minimum, double maximum) {
            String text = field.getText().trim();
            if (text.isEmpty()) return;
            double number = Double.parseDouble(text);
            if (!Double.isFinite(number) || number < minimum || number > maximum) throw new IllegalArgumentException(name + " 超出范围。");
            config.addProperty(name, number);
        }
        private void handle(JsonObject event) {
            switch (string(event, "type")) {
                case "text" -> append(string(event, "text"));
                case "ready" -> status.setText("就绪 · 模型上下文仅发送到你配置的地址");
                case "session" -> status.setText(string(event, "endpoint") + " · " + string(event, "model"));
                case "started" -> { busy = true; status.setText("运行中…"); }
                case "done" -> { busy = false; status.setText(string(event, "status")); if (event.has("error")) append("\n" + string(event, "error") + "\n"); }
                case "error" -> { busy = false; append("\n错误：" + string(event, "message") + "\n"); }
                case "notice" -> append("\n" + string(event, "text") + "\n");
                case "tool" -> status.setText("工具：" + string(event, "name"));
                case "approval" -> review(event);
                case "history" -> {
                    JsonArray ids = event.getAsJsonArray("ids"); String[] choices = new String[ids.size()];
                    for (int i = 0; i < ids.size(); i++) choices[i] = ids.get(i).getAsString();
                    String selected = (String) JOptionPane.showInputDialog(this, "恢复本地会话", "本地历史", JOptionPane.PLAIN_MESSAGE, null, choices, choices.length > 0 ? choices[0] : null);
                    if (selected != null) { output.setText(""); send("resume", Map.of("id", selected)); }
                }
                case "restored" -> {
                    for (JsonElement value : event.getAsJsonArray("messages")) {
                        JsonObject message = value.getAsJsonObject();
                        for (JsonElement part : message.getAsJsonArray("content")) {
                            if (string(part.getAsJsonObject(), "type").equals("text")) append("\n" + string(message, "role") + "：\n" + string(part.getAsJsonObject(), "text") + "\n");
                        }
                    }
                }
                default -> { }
            }
        }
        private void review(JsonObject event) {
            JComponent view; String title;
            if (string(event, "kind").equals("edit")) {
                JsonObject edit = event.getAsJsonObject("edit"); title = "审阅文件修改：" + string(edit, "path");
                JTextArea before = textArea(25, 45); before.setText(string(edit, "before")); before.setEditable(false);
                JTextArea after = textArea(25, 45); after.setText(string(edit, "after")); after.setEditable(false);
                JPanel left = new JPanel(new BorderLayout()); left.add(new JLabel("修改前"), BorderLayout.NORTH); left.add(new JScrollPane(before));
                JPanel right = new JPanel(new BorderLayout()); right.add(new JLabel("修改后"), BorderLayout.NORTH); right.add(new JScrollPane(after));
                JSplitPane split = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT, left, right); split.setResizeWeight(0.5); view = split;
            } else {
                title = "禁网沙箱命令（项目只读）"; JTextArea command = textArea(8, 75); command.setText(string(event, "command")); command.setEditable(false); view = new JScrollPane(command);
            }
            int decision = JOptionPane.showOptionDialog(this, view, title, JOptionPane.YES_NO_OPTION, JOptionPane.PLAIN_MESSAGE, null, new String[]{"批准一次", "拒绝"}, "拒绝");
            send("approval", Map.of("id", string(event, "id"), "accepted", decision == 0));
        }
        private void settings() {
            if (!idle()) return;
            try {
                Path directory = Paths.get(System.getProperty("user.home"), ".config", "cline-local");
                Files.createDirectories(directory);
                if (!directory.toRealPath().equals(directory.toAbsolutePath())) throw new IOException("配置目录不能使用符号链接。");
                Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwx------"));
                Path config = directory.resolve("config.json");
                if (Files.isSymbolicLink(config)) throw new IOException("配置不能是符号链接。");
                JsonObject value = Files.exists(config) ? JsonParser.parseString(Files.readString(config)).getAsJsonObject() : new JsonObject();
                JTextField endpoint = new JTextField(string(value, "baseUrl"), 35);
                JTextField model = new JTextField(string(value, "model"), 35);
                JPasswordField key = new JPasswordField(35);
                JCheckBox clearKey = new JCheckBox("清除已保存的 API Key");
                JTextField contextWindow = new JTextField(value.has("contextWindow") ? value.get("contextWindow").getAsString() : "131072", 35);
                JTextField maxTokens = new JTextField(value.has("maxTokens") ? value.get("maxTokens").getAsString() : "4096", 35);
                JTextField temperature = new JTextField(value.has("temperature") ? value.get("temperature").getAsString() : "", 35);
                JTextField topP = new JTextField(string(value, "topP"), 35);
                JTextField frequencyPenalty = new JTextField(string(value, "frequencyPenalty"), 35);
                JTextField presencePenalty = new JTextField(string(value, "presencePenalty"), 35);
                JTextField seed = new JTextField(string(value, "seed"), 35);
                JComboBox<String> reasoning = new JComboBox<>(new String[]{"none", "low", "medium", "high", "xhigh"});
                reasoning.setSelectedItem(value.has("reasoningEffort") ? value.get("reasoningEffort").getAsString() : "none");
                JCheckBox commands = new JCheckBox("启用 Linux 禁网命令（需本机 bubblewrap）", value.has("commands") && value.get("commands").getAsBoolean());
                JPanel form = new JPanel(new GridLayout(0, 1, 4, 4));
                form.add(new JLabel("内网地址，例如 http://192.168.1.50:8000/v1")); form.add(endpoint);
                form.add(new JLabel("模型 ID")); form.add(model);
                form.add(new JLabel("上下文窗口 token（4096–2000000）")); form.add(contextWindow);
                form.add(new JLabel("最大输出 token（128–32768）")); form.add(maxTokens);
                form.add(new JLabel("Temperature（0–2，留空由模型决定）")); form.add(temperature);
                form.add(new JLabel("Top P（大于 0 且不超过 1，留空由模型决定）")); form.add(topP);
                form.add(new JLabel("频率惩罚（-2–2，留空由模型决定）")); form.add(frequencyPenalty);
                form.add(new JLabel("存在惩罚（-2–2，留空由模型决定）")); form.add(presencePenalty);
                form.add(new JLabel("随机种子（0–2147483647，留空由模型决定）")); form.add(seed);
                form.add(new JLabel("以上可选参数仅在填写时发送，需模型服务支持。"));
                form.add(new JLabel("Reasoning Effort（仅适用支持该参数的模型）")); form.add(reasoning);
                form.add(new JLabel("API Key（留空保留已保存值）")); form.add(key); form.add(clearKey); form.add(commands);
                form.add(new JLabel("发送任务时，相关代码上下文会传给此模型。"));
                JScrollPane scroll = new JScrollPane(form);
                scroll.setPreferredSize(new Dimension(440, 580));
                if (JOptionPane.showConfirmDialog(this, scroll, "本地模型设置", JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE) != JOptionPane.OK_OPTION) return;
                int context = Integer.parseInt(contextWindow.getText().trim());
                int outputLimit = Integer.parseInt(maxTokens.getText().trim());
                if (context < 4096 || context > 2_000_000 || outputLimit < 128 || outputLimit > 32768 || context <= outputLimit) throw new IllegalArgumentException("上下文窗口或输出 token 超出范围。");
                String tempText = temperature.getText().trim();
                double temp = tempText.isEmpty() ? 0 : Double.parseDouble(tempText);
                if (!tempText.isEmpty() && (!Double.isFinite(temp) || temp < 0 || temp > 2)) throw new IllegalArgumentException("Temperature 必须在 0–2 之间。");
                String savedKey = string(value, "apiKey");
                value = new JsonObject(); value.addProperty("baseUrl", endpoint.getText().trim()); value.addProperty("model", model.getText().trim());
                value.addProperty("apiKey", clearKey.isSelected() ? "" : key.getPassword().length == 0 ? savedKey : new String(key.getPassword()));
                value.addProperty("contextWindow", context); value.addProperty("maxTokens", outputLimit);
                if (!tempText.isEmpty()) value.addProperty("temperature", temp);
                addOptionalNumber(value, "topP", topP, Double.MIN_VALUE, 1);
                addOptionalNumber(value, "frequencyPenalty", frequencyPenalty, -2, 2);
                addOptionalNumber(value, "presencePenalty", presencePenalty, -2, 2);
                String seedText = seed.getText().trim();
                if (!seedText.isEmpty()) {
                    long seedValue = Long.parseLong(seedText);
                    if (seedValue < 0 || seedValue > 2_147_483_647L) throw new IllegalArgumentException("随机种子超出范围。");
                    value.addProperty("seed", seedValue);
                }
                value.addProperty("reasoningEffort", (String) reasoning.getSelectedItem()); value.addProperty("commands", commands.isSelected());
                Path temporary = Files.createTempFile(directory, "config-", ".tmp");
                Files.setPosixFilePermissions(temporary, PosixFilePermissions.fromString("rw-------"));
                Files.writeString(temporary, gson.toJson(value) + "\n");
                Files.move(temporary, config, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                send("new", null); append("\n配置已保存；新任务启动前会校验模型地址。\n");
            } catch (Exception error) { append("\n设置失败：" + error.getMessage() + "\n"); }
        }
        @Override public void dispose() {
            disposed = true;
            if (process != null) {
                try { if (writer != null) writer.close(); } catch (IOException ignored) { }
                process.destroy();
            }
        }
    }
}
