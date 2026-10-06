using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Synthetic, cooperatively controlled test application. Never touches another application's window.
internal sealed class NonActivatingForm : Form {
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
        get { var p = base.CreateParams; p.ExStyle |= 0x08000000; return p; }
    }
}
internal sealed class TickCanvas : Control {
    internal int Tick;
    internal static readonly Color Canvas = Color.FromArgb(36,132,159);
    internal static readonly Color One = Color.FromArgb(54,206,145);
    internal static readonly Color Zero = Color.FromArgb(213,43,78);
    internal static readonly Color Cover = Color.FromArgb(163,69,202);
    internal TickCanvas() { DoubleBuffered = true; }
    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.Clear(Canvas);
        for (int bit = 0; bit < 16; bit++) {
            using (var brush = new SolidBrush(((Tick >> bit) & 1) != 0 ? One : Zero))
                e.Graphics.FillRectangle(brush, 10 + bit * 13, 10, 10, 12);
        }
        e.Graphics.DrawString("Owned selected-window tick: " + Tick, Font, Brushes.White, 10, 35);
    }
}
// Records messages processed by this owned control, never injects physical/global input.
internal sealed class NativeKeyTextBox : TextBox {
    internal readonly List<object> Messages = new List<object>();
    // A deliberately willing message receiver; results do not establish Firefox key behavior.
    protected override bool IsInputKey(Keys keyData) { return true; }
    protected override void WndProc(ref Message message) {
        if (message.Msg == 0x100 || message.Msg == 0x101 || message.Msg == 0x102)
            Messages.Add(new { message=message.Msg, key=message.WParam.ToInt64() });
        base.WndProc(ref message);
    }
}
internal static class Fixture {
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly object OutputLock = new object();
    static NonActivatingForm form, cover;
    static TickCanvas canvas;
    static TextBox value;
    static NativeKeyTextBox keys;
    static TextBox password;
    static bool coverAll;
    static CheckBox toggle;
    static ListBox list, scroll;
    static TreeView tree;
    static string token;
    static int invokes, valueChanges, toggles, selections, expansions, scrollChanges;
    static void Write(object result) { lock (OutputLock) { Console.WriteLine(Json.Serialize(result)); Console.Out.Flush(); } }
    static Dictionary<string, object> State() {
        var process = Process.GetCurrentProcess();
        return new Dictionary<string,object> {
            {"hwnd",form.Handle.ToInt64().ToString("x")}, {"pid",process.Id},
            {"processCreated",process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString("x16")},
            {"executable",process.MainModule.FileName}, {"minimized",form.WindowState == FormWindowState.Minimized},
            {"tick",canvas.Tick}, {"invokes",invokes}, {"value",value.Text}, {"valueChanges",valueChanges},
            {"toggled",toggle.Checked}, {"toggles",toggles}, {"selectedIndex",list.SelectedIndex}, {"selections",selections},
            {"treeExpanded",tree.Nodes[0].IsExpanded}, {"expansions",expansions},
            {"scrollTop",scroll.TopIndex}, {"scrollChanges",scrollChanges}, {"coverVisible",cover.Visible},
            {"coverAll",coverAll}, {"keyValue",keys.Text}, {"keyMessages",keys.Messages.ToArray()},
            {"clipboardSequence",GetClipboardSequenceNumber()},
            {"widthPx",form.Width}, {"heightPx",form.Height}
        };
    }
    static object VerifyImage(string file) {
        // Inspect only the selected-window PNG supplied by the harness; no screen capture API.
        using (var image = new Bitmap(file)) {
            int canvasPixels = 0, coverPixels = 0, decoded = -1;
            for (int y = 0; y < image.Height; y++) {
                int bits = 0, run = 0, previous = 0;
                for (int x = 0; x < image.Width; x++) {
                    int rgb = image.GetPixel(x,y).ToArgb() & 0xffffff;
                    if (rgb == (TickCanvas.Canvas.ToArgb() & 0xffffff)) canvasPixels++;
                    if (rgb == (TickCanvas.Cover.ToArgb() & 0xffffff)) coverPixels++;
                    int color = rgb == (TickCanvas.One.ToArgb() & 0xffffff) ? 1 : rgb == (TickCanvas.Zero.ToArgb() & 0xffffff) ? 2 : 0;
                    if (color != 0 && previous == 0 && run < 16) { if (color == 1) bits |= 1 << run; run++; }
                    previous = color;
                }
                if (decoded < 0 && run == 16) decoded = bits;
            }
            return new { widthPx=image.Width, heightPx=image.Height, canvasPixels=canvasPixels, coverPixels=coverPixels, tickFromImage=decoded };
        }
    }
    static void Command(Dictionary<string,object> input) {
        object id = input.ContainsKey("id") ? input["id"] : null;
        try {
            if (!input.ContainsKey("token") || (string)input["token"] != token) throw new InvalidOperationException("Fixture command token mismatch");
            string command = (string)input["command"];
            object result;
            if (command == "state") result = State();
            else if (command == "minimize") { form.WindowState = FormWindowState.Minimized; result = State(); }
            else if (command == "cover" || command == "coverAll") { coverAll = command == "coverAll"; if (!cover.Visible) cover.Show(form); PositionCover(); result = State(); }
            else if (command == "uncover") { cover.Hide(); result = State(); }
            else if (command == "verifyImage") result = VerifyImage((string)input["path"]);
            else if (command == "prepareKeys") { keys.Text = (string)input["value"]; keys.Select(keys.Text.Length,0); keys.Messages.Clear(); result = State(); }
            else if (command == "shutdown") { Write(new { id=id, result=new { shutdown=true } }); cover.Close(); form.Close(); return; }
            else throw new InvalidOperationException("Unknown fixture command");
            Write(new { id=id, result=result });
        } catch (Exception error) { Write(new { id=id, error=error.Message }); }
    }
    static void PositionCover() {
        cover.Bounds = coverAll ? form.Bounds : new Rectangle(form.PointToScreen(canvas.Location),canvas.Size);
    }
    [STAThread]
    static void Main(string[] args) {
        if (args.Length != 2 || args[0] != "--token" || args[1].Length != 36) return;
        token = args[1];
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        form = new NonActivatingForm { Text="Azrael owned native fixture " + token, StartPosition=FormStartPosition.Manual,
            Bounds=new Rectangle(Screen.PrimaryScreen.WorkingArea.Left + 30,Screen.PrimaryScreen.WorkingArea.Top + 30,640,650),
            MinimumSize=new Size(360,420), MaximumSize=new Size(1200,1000), MinimizeBox=false, MaximizeBox=false };
        canvas = new TickCanvas { Bounds=new Rectangle(20,20,300,85), AccessibleName="Fixture Tick Canvas" };
        var button = new Button { Text="Fixture Invoke", AccessibleName="Fixture Invoke", Bounds=new Rectangle(20,120,140,30) };
        button.Click += delegate { invokes++; };
        value = new TextBox { AccessibleName="Fixture Value", Bounds=new Rectangle(20,165,260,28) };
        value.TextChanged += delegate { valueChanges++; };
        keys = new NativeKeyTextBox { Name="fixtureKeys", AccessibleName="Fixture Keys", Bounds=new Rectangle(350,350,230,70), Multiline=true, AcceptsReturn=true, AcceptsTab=true };
        password = new TextBox { Name="fixturePassword", AccessibleName="Fixture Password", Bounds=new Rectangle(350,440,230,28), UseSystemPasswordChar=true, Text="fixture-secret" };
        var disabled = new Button { Name="fixtureDisabled", AccessibleName="Fixture Disabled", Text="Disabled", Enabled=false, Bounds=new Rectangle(350,485,180,30) };
        toggle = new CheckBox { Text="Fixture Toggle", AccessibleName="Fixture Toggle", Bounds=new Rectangle(20,205,200,30) };
        toggle.CheckedChanged += delegate { toggles++; };
        list = new ListBox { AccessibleName="Fixture Selection", Bounds=new Rectangle(20,250,200,80) };
        list.Items.AddRange(new object[] {"Fixture Item 0","Fixture Item 1","Fixture Item 2"});
        list.SelectedIndexChanged += delegate { selections++; };
        tree = new TreeView { AccessibleName="Fixture Tree", Bounds=new Rectangle(20,350,220,130) };
        var branch = new TreeNode("Fixture Branch"); branch.Nodes.Add("Fixture Leaf"); tree.Nodes.Add(branch);
        tree.AfterExpand += delegate { expansions++; }; tree.AfterCollapse += delegate { expansions++; };
        scroll = new ListBox { AccessibleName="Fixture Scroll List", Bounds=new Rectangle(350,120,230,190) };
        for (int i=0;i<60;i++) scroll.Items.Add("Fixture Scroll Row " + i);
        scroll.SelectedIndexChanged += delegate { scrollChanges++; };
        form.Controls.AddRange(new Control[] {canvas,button,value,toggle,list,tree,scroll,keys,password,disabled});
        cover = new NonActivatingForm { FormBorderStyle=FormBorderStyle.None, BackColor=TickCanvas.Cover, ShowInTaskbar=false };
        form.Move += delegate { if (cover.Visible) PositionCover(); };
        form.Resize += delegate { if (cover.Visible && form.WindowState != FormWindowState.Minimized) PositionCover(); };
        var timer = new System.Windows.Forms.Timer { Interval=200 };
        timer.Tick += delegate { canvas.Tick = (canvas.Tick + 1) & 65535; canvas.Invalidate(); };
        form.Shown += delegate {
            timer.Start();
            form.WindowState = FormWindowState.Minimized;
            Write(new { ready=true, identity=State() });
            var reader = new Thread(delegate() {
                string line;
                while ((line=Console.ReadLine()) != null) {
                    try {
                        var command=Json.Deserialize<Dictionary<string,object>>(line);
                        if (!form.IsDisposed) form.BeginInvoke(new Action(delegate { Command(command); }));
                    } catch (Exception error) { Write(new { error=error.Message }); }
                }
            }); reader.IsBackground=true; reader.Start();
        };
        Application.Run(form);
        timer.Dispose(); cover.Dispose(); form.Dispose();
    }
}
